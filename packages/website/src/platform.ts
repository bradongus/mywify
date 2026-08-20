export type Platform = 'windows' | 'android' | 'linux' | 'macos' | 'other';

export function detectPlatform(ua?: string): Platform {
  const userAgent = ua ?? navigator.userAgent;
  if (userAgent.includes('Windows')) return 'windows';
  if (userAgent.includes('Android')) return 'android';
  if (userAgent.includes('Linux')) return 'linux';
  if (userAgent.includes('Macintosh')) return 'macos';
  return 'other';
}
