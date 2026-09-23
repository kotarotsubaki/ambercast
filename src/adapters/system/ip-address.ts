/*
 * Provides the host IP classifier at the designated system-adapter boundary.
 * Keeping the platform API here lets bind-host policy receive a deterministic
 * classifier without importing Node networking into core code.
 */

import { isIP } from 'node:net';

/**
 * Classifies an address using the host runtime's IP-literal parser.
 *
 * @param value - A candidate host address.
 * @returns Zero for a non-IP value, or the detected IPv4 or IPv6 family.
 */
export const isIpAddress = (value: string): 0 | 4 | 6 => isIP(value) as 0 | 4 | 6;
