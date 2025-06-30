import { NodeSpecs } from '../types/interfaces';
import { Logger } from '../utils/Logger';

export class RoomServerNodeModel {
    private logger: Logger;

    constructor() {
        this.logger = new Logger('RoomServerNodeModel');
    }

    // Create new room server instance
    create(data: {
        serverId: string;
        url: string;
        region: string;
        rooms?: string[];
        capacity: number;
        specs: NodeSpecs;
        metadata?: Record<string, any>;
    }) {
        return {
            id: data.serverId,
            url: data.url,
            region: data.region,
            rooms: data.rooms || [],
            capacity: data.capacity,
            currentLoad: 0,
            isHealthy: true,
            lastHeartbeat: Date.now(),
            specs: data.specs,
            metadata: data.metadata || {},
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
    }

    // Validate room server data
    validate(data: any): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!data.serverId || typeof data.serverId !== 'string') {
            errors.push('serverId is required and must be a string');
        }

        if (!data.url || typeof data.url !== 'string') {
            errors.push('url is required and must be a string');
        }

        if (!data.region || typeof data.region !== 'string') {
            errors.push('region is required and must be a string');
        }

        if (!data.capacity || typeof data.capacity !== 'number' || data.capacity <= 0) {
            errors.push('capacity is required and must be a positive number');
        }

        if (!data.specs || typeof data.specs !== 'object') {
            errors.push('specs is required and must be an object');
        } else {
            const specsErrors = this.validateSpecs(data.specs);
            errors.push(...specsErrors);
        }

        // Validate URL format
        try {
            new URL(data.url);
        } catch {
            errors.push('url must be a valid URL');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    private validateSpecs(specs: any): string[] {
        const errors: string[] = [];

        if (!specs.cpuCores || typeof specs.cpuCores !== 'number' || specs.cpuCores <= 0) {
            errors.push('specs.cpuCores is required and must be a positive number');
        }

        if (!specs.ram || typeof specs.ram !== 'number' || specs.ram <= 0) {
            errors.push('specs.ram is required and must be a positive number');
        }

        if (specs.hasGPU !== undefined && typeof specs.hasGPU !== 'boolean') {
            errors.push('specs.hasGPU must be a boolean');
        }

        if (!specs.diskSpace || typeof specs.diskSpace !== 'number' || specs.diskSpace <= 0) {
            errors.push('specs.diskSpace is required and must be a positive number');
        }

        return errors;
    }

    // Update room server properties
    update(roomServer: any, updates: Partial<any>) {
        const updatedServer = {
            ...roomServer,
            ...updates,
            updatedAt: Date.now()
        };

        // Log significant changes
        if (updates.isHealthy !== undefined && updates.isHealthy !== roomServer.isHealthy) {
            this.logger.info(`Room server ${roomServer.id} health changed`, {
                from: roomServer.isHealthy,
                to: updates.isHealthy
            });
        }

        if (updates.currentLoad !== undefined && updates.currentLoad !== roomServer.currentLoad) {
            this.logger.debug(`Room server ${roomServer.id} load changed`, {
                from: roomServer.currentLoad,
                to: updates.currentLoad,
                capacity: roomServer.capacity
            });
        }

        return updatedServer;
    }

    // Calculate health score
    calculateHealthScore(roomServer: any): number {
        let score = 100;

        // Check heartbeat freshness
        const timeSinceHeartbeat = Date.now() - roomServer.lastHeartbeat;
        if (timeSinceHeartbeat > 60000) { // 1 minute
            score -= 40;
        } else if (timeSinceHeartbeat > 30000) { // 30 seconds
            score -= 20;
        }

        // Check load
        const loadPercentage = (roomServer.currentLoad / roomServer.capacity) * 100;
        if (loadPercentage > 90) {
            score -= 30;
        } else if (loadPercentage > 80) {
            score -= 15;
        }

        // Check if explicitly marked unhealthy
        if (!roomServer.isHealthy) {
            score -= 50;
        }

        return Math.max(0, score);
    }

    // Get room server statistics
    getStatistics(roomServer: any) {
        const loadPercentage = (roomServer.currentLoad / roomServer.capacity) * 100;

        return {
            id: roomServer.id,
            region: roomServer.region,
            load: {
                current: roomServer.currentLoad,
                capacity: roomServer.capacity,
                percentage: Math.round(loadPercentage)
            },
            health: {
                isHealthy: roomServer.isHealthy,
                score: this.calculateHealthScore(roomServer),
                lastHeartbeat: roomServer.lastHeartbeat,
                timeSinceHeartbeat: Date.now() - roomServer.lastHeartbeat
            },
            rooms: {
                count: roomServer.rooms.length,
                list: roomServer.rooms
            },
            specs: roomServer.specs,
            uptime: Date.now() - roomServer.createdAt
        };
    }

    // Check if room server can handle new load
    canAcceptLoad(roomServer: any, additionalLoad: number = 1): boolean {
        return roomServer.isHealthy &&
            (roomServer.currentLoad + additionalLoad) <= roomServer.capacity;
    }

    // Get load capacity information
    getLoadInfo(roomServer: any) {
        const available = roomServer.capacity - roomServer.currentLoad;
        const percentage = (roomServer.currentLoad / roomServer.capacity) * 100;

        return {
            current: roomServer.currentLoad,
            capacity: roomServer.capacity,
            available,
            percentage: Math.round(percentage),
            status: percentage > 90 ? 'overloaded' :
                percentage > 80 ? 'high' :
                    percentage > 60 ? 'medium' : 'low'
        };
    }
}