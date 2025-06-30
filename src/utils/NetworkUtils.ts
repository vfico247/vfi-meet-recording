// src/utils/NetworkUtils.ts
import { Logger } from './Logger';

const logger = new Logger('NetworkUtils');

export class NetworkUtils {

    // Extract IP address from URL
    static extractIPFromURL(url: string): string {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch (error) {
            logger.error('Failed to extract IP from URL:', error);
            return 'localhost';
        }
    }

    // Get local IP address
    static getLocalIP(): string {
        const { networkInterfaces } = require('os');
        const nets = networkInterfaces();

        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                // Skip over non-IPv4 and internal addresses
                if (net.family === 'IPv4' && !net.internal) {
                    return net.address;
                }
            }
        }

        return '127.0.0.1';
    }

    // Get all network interfaces
    static getAllNetworkInterfaces(): any[] {
        const { networkInterfaces } = require('os');
        const nets = networkInterfaces();
        const interfaces = [];

        for (const [name, netList] of Object.entries(nets)) {
            for (const net of netList as any[]) {
                interfaces.push({
                    interface: name,
                    family: net.family,
                    address: net.address,
                    internal: net.internal,
                    mac: net.mac,
                    cidr: net.cidr
                });
            }
        }

        return interfaces;
    }

    // Check if port is available
    static async isPortAvailable(port: number, host: string = 'localhost'): Promise<boolean> {
        return new Promise((resolve) => {
            const net = require('net');
            const server = net.createServer();

            server.listen(port, host, () => {
                server.once('close', () => resolve(true));
                server.close();
            });

            server.on('error', () => resolve(false));
        });
    }

    // Find available port in range
    static async findAvailablePort(startPort: number, endPort: number, host: string = 'localhost'): Promise<number | null> {
        for (let port = startPort; port <= endPort; port++) {
            if (await this.isPortAvailable(port, host)) {
                return port;
            }
        }
        return null;
    }

    // Find multiple available ports
    static async findAvailablePorts(count: number, startPort: number = 5000, endPort: number = 6000, host: string = 'localhost'): Promise<number[]> {
        const availablePorts: number[] = [];

        for (let port = startPort; port <= endPort && availablePorts.length < count; port++) {
            if (await this.isPortAvailable(port, host)) {
                availablePorts.push(port);
            }
        }

        return availablePorts;
    }

    // Validate URL format
    static isValidURL(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    // Validate IP address
    static isValidIP(ip: string): boolean {
        const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

        return ipv4Regex.test(ip) || ipv6Regex.test(ip);
    }

    // Validate port number
    static isValidPort(port: number): boolean {
        return Number.isInteger(port) && port >= 1 && port <= 65535;
    }

    // Parse connection string
    static parseConnectionString(connectionString: string): any {
        try {
            const url = new URL(connectionString);
            return {
                protocol: url.protocol.slice(0, -1),
                host: url.hostname,
                port: parseInt(url.port) || this.getDefaultPort(url.protocol),
                database: url.pathname.slice(1),
                username: url.username,
                password: url.password,
                search: url.search,
                params: Object.fromEntries(url.searchParams.entries())
            };
        } catch (error) {
            logger.error('Failed to parse connection string:', error);
            return null;
        }
    }

    private static getDefaultPort(protocol: string): number {
        const defaultPorts: Record<string, number> = {
            'http:': 80,
            'https:': 443,
            'postgres:': 5432,
            'postgresql:': 5432,
            'mysql:': 3306,
            'redis:': 6379,
            'mongodb:': 27017,
            'ftp:': 21,
            'ssh:': 22,
            'telnet:': 23,
            'smtp:': 25
        };

        return defaultPorts[protocol] || 80;
    }

    // Test network connectivity
    static async testConnectivity(host: string, port: number, timeout: number = 5000): Promise<boolean> {
        return new Promise((resolve) => {
            const net = require('net');
            const socket = new net.Socket();

            const timer = setTimeout(() => {
                socket.destroy();
                resolve(false);
            }, timeout);

            socket.connect(port, host, () => {
                clearTimeout(timer);
                socket.destroy();
                resolve(true);
            });

            socket.on('error', () => {
                clearTimeout(timer);
                resolve(false);
            });
        });
    }

    // Test HTTP/HTTPS connectivity
    static async testHTTPConnectivity(url: string, timeout: number = 5000): Promise<{ success: boolean; statusCode?: number; error?: string }> {
        try {
            const urlObj = new URL(url);
            const isHttps = urlObj.protocol === 'https:';
            const httpModule = isHttps ? require('https') : require('http');

            return new Promise((resolve) => {
                const request = httpModule.get(url, { timeout }, (response: any) => {
                    resolve({
                        success: true,
                        statusCode: response.statusCode
                    });
                });

                request.on('error', (error: Error) => {
                    resolve({
                        success: false,
                        error: error.message
                    });
                });

                request.on('timeout', () => {
                    request.destroy();
                    resolve({
                        success: false,
                        error: 'Request timeout'
                    });
                });
            });
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Invalid URL'
            };
        }
    }

    // Calculate network latency
    static async measureLatency(host: string, port: number, samples: number = 3): Promise<number> {
        const latencies: number[] = [];

        for (let i = 0; i < samples; i++) {
            const start = Date.now();
            const connected = await this.testConnectivity(host, port, 10000);
            const end = Date.now();

            if (connected) {
                latencies.push(end - start);
            }
        }

        if (latencies.length === 0) {
            return -1; // Connection failed
        }

        return latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
    }

    // Get network statistics
    static async getNetworkStats(host: string, port: number): Promise<any> {
        const start = Date.now();

        const connectivity = await this.testConnectivity(host, port);
        const latency = connectivity ? await this.measureLatency(host, port, 5) : -1;

        return {
            host,
            port,
            connectivity,
            latency,
            timestamp: Date.now(),
            testDuration: Date.now() - start
        };
    }

    // Resolve hostname to IP
    static async resolveHostname(hostname: string): Promise<string[]> {
        try {
            const dns = require('dns').promises;
            const result = await dns.lookup(hostname, { all: true });
            return result.map((entry: any) => entry.address);
        } catch (error) {
            logger.error(`Failed to resolve hostname ${hostname}:`, error);
            return [];
        }
    }

    // Get public IP address
    static async getPublicIP(): Promise<string | null> {
        const services = [
            'https://api.ipify.org',
            'https://ifconfig.me/ip',
            'https://icanhazip.com'
        ];

        for (const service of services) {
            try {
                const response = await this.testHTTPConnectivity(service);
                if (response.success && response.statusCode === 200) {
                    // This would need actual HTTP client to get response body
                    logger.info(`Public IP service ${service} is accessible`);
                    // Return placeholder - in real implementation, you'd fetch the actual IP
                    return '0.0.0.0'; // Placeholder
                }
            } catch (error) {
                continue;
            }
        }

        return null;
    }

    // Check if address is private/internal
    static isPrivateIP(ip: string): boolean {
        const privateRanges = [
            /^10\./,                    // 10.0.0.0/8
            /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12
            /^192\.168\./,              // 192.168.0.0/16
            /^127\./,                   // 127.0.0.0/8 (loopback)
            /^169\.254\./,              // 169.254.0.0/16 (link-local)
            /^::1$/,                    // IPv6 loopback
            /^fe80:/,                   // IPv6 link-local
            /^fc00:/,                   // IPv6 unique local
            /^fd00:/                    // IPv6 unique local
        ];

        return privateRanges.some(range => range.test(ip));
    }

    // Create connection string
    static createConnectionString(options: {
        protocol: string;
        host: string;
        port?: number;
        username?: string;
        password?: string;
        database?: string;
        params?: Record<string, string>;
    }): string {
        const { protocol, host, port, username, password, database, params } = options;

        let url = `${protocol}://`;

        if (username) {
            url += username;
            if (password) {
                url += `:${password}`;
            }
            url += '@';
        }

        url += host;

        if (port) {
            url += `:${port}`;
        }

        if (database) {
            url += `/${database}`;
        }

        if (params && Object.keys(params).length > 0) {
            const searchParams = new URLSearchParams(params);
            url += `?${searchParams.toString()}`;
        }

        return url;
    }

    // Network interface monitoring
    static getNetworkInterfaceStats(): any {
        const { networkInterfaces } = require('os');
        const nets = networkInterfaces();
        const stats = {
            totalInterfaces: 0,
            activeInterfaces: 0,
            ipv4Addresses: 0,
            ipv6Addresses: 0,
            publicAddresses: 0,
            privateAddresses: 0,
            interfaces: [] as any[]
        };

        for (const [name, netList] of Object.entries(nets)) {
            stats.totalInterfaces++;

            for (const net of netList as any[]) {
                if (!net.internal) {
                    stats.activeInterfaces++;

                    if (net.family === 'IPv4') {
                        stats.ipv4Addresses++;
                        if (this.isPrivateIP(net.address)) {
                            stats.privateAddresses++;
                        } else {
                            stats.publicAddresses++;
                        }
                    } else if (net.family === 'IPv6') {
                        stats.ipv6Addresses++;
                    }

                    stats.interfaces.push({
                        name,
                        family: net.family,
                        address: net.address,
                        internal: net.internal,
                        mac: net.mac
                    });
                }
            }
        }

        return stats;
    }
}

// ERROR HANDLING UTILITIES
export class ErrorUtils {
    static getErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }

        if (typeof error === 'string') {
            return error;
        }

        if (error && typeof error === 'object' && 'message' in error) {
            return String((error as any).message);
        }

        return 'Unknown error occurred';
    }

    static getErrorDetails(error: unknown): { message: string; stack?: string; name?: string; code?: string } {

        return {
            message: ErrorUtils.getErrorMessage(error)  // Fix: Use class name instead of 'this'
        };
    }

    static isNetworkError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;

        const networkErrorCodes = [
            'ECONNREFUSED',   // Connection refused
            'ENOTFOUND',      // DNS lookup failed
            'ETIMEDOUT',      // Connection timeout
            'ECONNRESET',     // Connection reset by peer
            'EHOSTUNREACH',   // Host unreachable
            'ENETUNREACH',    // Network unreachable
            'ECONNABORTED',   // Connection aborted
            'EPIPE',          // Broken pipe
            'EADDRNOTAVAIL'   // Address not available
        ];

        const errorCode = (error as any).code;
        return networkErrorCodes.includes(errorCode) ||
            networkErrorCodes.some(code => error.message.includes(code));
    }

    static isTimeoutError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;

        return error.message.toLowerCase().includes('timeout') ||
            (error as any).code === 'ETIMEDOUT';
    }

    static isDNSError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;

        return (error as any).code === 'ENOTFOUND' ||
            error.message.toLowerCase().includes('dns');
    }

    static isConnectionError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;

        const connectionErrorCodes = ['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED'];
        return connectionErrorCodes.includes((error as any).code);
    }

    static categorizeError(error: unknown): string {
        if (ErrorUtils.isTimeoutError(error)) return 'timeout';
        if (ErrorUtils.isDNSError(error)) return 'dns';
        if (ErrorUtils.isConnectionError(error)) return 'connection';
        if (ErrorUtils.isNetworkError(error)) return 'network';
        return 'unknown';
    }

    static getErrorSuggestion(error: unknown): string {
        const category = ErrorUtils.categorizeError(error);

        const suggestions = {
            timeout: 'Check network connectivity and increase timeout values',
            dns: 'Verify hostname is correct and DNS servers are accessible',
            connection: 'Ensure the target service is running and accessible',
            network: 'Check network configuration and firewall settings',
            unknown: 'Review error details and check system logs'
        };

        return suggestions[category as keyof typeof suggestions] || suggestions.unknown;
    }

    // Retry logic with exponential backoff
    static async retryWithBackoff<T>(
        operation: () => Promise<T>,
        maxRetries: number = 3,
        initialDelay: number = 1000,
        backoffFactor: number = 2
    ): Promise<T> {
        let lastError: unknown;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;

                if (attempt === maxRetries) {
                    break;
                }

                // Only retry on network errors
                if (!ErrorUtils.isNetworkError(error)) {
                    break;
                }

                const delay = initialDelay * Math.pow(backoffFactor, attempt - 1);
                logger.info(`Attempt ${attempt} failed, retrying in ${delay}ms:`, ErrorUtils.getErrorMessage(error));

                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }

    // Enhanced error logging
    static logError(logger: Logger, operation: string, error: unknown, context?: any): void {
        const errorDetails = ErrorUtils.getErrorDetails(error);
        const category = ErrorUtils.categorizeError(error);
        const suggestion = ErrorUtils.getErrorSuggestion(error);

        logger.error(`${operation} failed:`, {
            message: errorDetails.message,
            category,
            suggestion,
            code: errorDetails.code,
            context,
            stack: errorDetails.stack
        });
    }
}