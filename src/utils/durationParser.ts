
/**
 * Parses a duration string (e.g., "10m", "1h", "7d") into milliseconds.
 * Returns null if the format is invalid.
 */
export function parseDuration(durationStr: string): number | null {
    const durationRegex = /^(\d+)([smhd])$/;
    const match = durationStr.toLowerCase().match(durationRegex);

    if (!match) {
        return null;
    }

    const value = parseInt(match[1]);
    const unit = match[2];
    let multiplier: number;

    switch (unit) {
        case 's':
            multiplier = 1000; // seconds
            break;
        case 'm':
            multiplier = 60 * 1000; // minutes
            break;
        case 'h':
            multiplier = 60 * 60 * 1000; // hours
            break;
        case 'd':
            multiplier = 24 * 60 * 60 * 1000; // days
            break;
        default:
            return null; // Should not happen due to regex
    }

    return value * multiplier;
}