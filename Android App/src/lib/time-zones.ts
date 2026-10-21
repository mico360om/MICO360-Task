/**
 * The time zones offered on a phone whose JavaScript can't list them (Hermes has no
 * `Intl.supportedValuesOf`). The main IANA zone of every region and the larger cities, in the
 * website's naming; the one you chose on the website is always offered too (date-settings).
 */
export const TIME_ZONES: readonly string[] = [
  'UTC',
  // Africa
  'Africa/Abidjan', 'Africa/Accra', 'Africa/Addis_Ababa', 'Africa/Algiers', 'Africa/Cairo', 'Africa/Casablanca',
  'Africa/Dar_es_Salaam', 'Africa/Johannesburg', 'Africa/Khartoum', 'Africa/Kinshasa', 'Africa/Lagos', 'Africa/Luanda',
  'Africa/Maputo', 'Africa/Nairobi', 'Africa/Tripoli', 'Africa/Tunis', 'Africa/Windhoek',
  // Americas
  'America/Anchorage', 'America/Argentina/Buenos_Aires', 'America/Bogota', 'America/Caracas', 'America/Chicago',
  'America/Denver', 'America/Edmonton', 'America/Guatemala', 'America/Halifax', 'America/Havana', 'America/Lima',
  'America/Los_Angeles', 'America/Mexico_City', 'America/Montevideo', 'America/New_York', 'America/Panama',
  'America/Phoenix', 'America/Puerto_Rico', 'America/Santiago', 'America/Santo_Domingo', 'America/Sao_Paulo',
  'America/St_Johns', 'America/Toronto', 'America/Vancouver', 'America/Winnipeg',
  // Asia
  'Asia/Almaty', 'Asia/Amman', 'Asia/Baghdad', 'Asia/Bahrain', 'Asia/Baku', 'Asia/Bangkok', 'Asia/Beirut',
  'Asia/Colombo', 'Asia/Damascus', 'Asia/Dhaka', 'Asia/Dubai', 'Asia/Ho_Chi_Minh', 'Asia/Hong_Kong', 'Asia/Jakarta',
  'Asia/Jerusalem', 'Asia/Kabul', 'Asia/Karachi', 'Asia/Kathmandu', 'Asia/Kolkata', 'Asia/Kuala_Lumpur', 'Asia/Kuwait',
  'Asia/Manila', 'Asia/Muscat', 'Asia/Qatar', 'Asia/Riyadh', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Singapore',
  'Asia/Taipei', 'Asia/Tashkent', 'Asia/Tbilisi', 'Asia/Tehran', 'Asia/Tokyo', 'Asia/Yangon', 'Asia/Yerevan',
  // Atlantic
  'Atlantic/Azores', 'Atlantic/Canary', 'Atlantic/Cape_Verde', 'Atlantic/Reykjavik',
  // Australia
  'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Darwin', 'Australia/Hobart', 'Australia/Melbourne',
  'Australia/Perth', 'Australia/Sydney',
  // Europe
  'Europe/Amsterdam', 'Europe/Athens', 'Europe/Belgrade', 'Europe/Berlin', 'Europe/Brussels', 'Europe/Bucharest',
  'Europe/Budapest', 'Europe/Copenhagen', 'Europe/Dublin', 'Europe/Helsinki', 'Europe/Istanbul', 'Europe/Kyiv',
  'Europe/Lisbon', 'Europe/London', 'Europe/Madrid', 'Europe/Minsk', 'Europe/Moscow', 'Europe/Oslo', 'Europe/Paris',
  'Europe/Prague', 'Europe/Rome', 'Europe/Sofia', 'Europe/Stockholm', 'Europe/Vienna', 'Europe/Warsaw', 'Europe/Zurich',
  // Indian Ocean
  'Indian/Maldives', 'Indian/Mauritius', 'Indian/Reunion',
  // Pacific
  'Pacific/Auckland', 'Pacific/Fiji', 'Pacific/Guam', 'Pacific/Honolulu', 'Pacific/Port_Moresby', 'Pacific/Tongatapu',
];
