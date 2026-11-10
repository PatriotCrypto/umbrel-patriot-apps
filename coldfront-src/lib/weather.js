'use strict';
// Current weather from Open-Meteo (free, no account or key). Optional: nothing is requested until a location is set.
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FC = 'https://api.open-meteo.com/v1/forecast';
const TTL = 10 * 60 * 1000;

// WMO weather codes -> short label + emoji
const CODES = [
  [[0], 'Clear', '☀️', '🌙'], [[1], 'Mostly clear', '🌤️', '🌙'], [[2], 'Partly cloudy', '⛅', '☁️'], [[3], 'Overcast', '☁️', '☁️'],
  [[45, 48], 'Fog', '🌫️', '🌫️'], [[51, 53, 55, 56, 57], 'Drizzle', '🌦️', '🌧️'], [[61, 63, 80, 81], 'Rain', '🌧️', '🌧️'],
  [[65, 82], 'Heavy rain', '🌧️', '🌧️'], [[66, 67], 'Freezing rain', '🌧️', '🌧️'], [[71, 73, 77, 85], 'Snow', '🌨️', '🌨️'],
  [[75, 86], 'Heavy snow', '❄️', '❄️'], [[95], 'Thunderstorm', '⛈️', '⛈️'], [[96, 99], 'Thunderstorm, hail', '⛈️', '⛈️'],
];
function describe(code, day = true) {
  const c = CODES.find((r) => r[0].includes(code));
  return c ? { label: c[1], icon: day ? c[2] : c[3] } : { label: 'Unknown', icon: '🌡️' };
}

class Weather {
  constructor({ fetchImpl = (...a) => fetch(...a), now = () => Date.now() } = {}) { this.f = fetchImpl; this.now = now; this.cache = null; }

  async search(q) {
    const name = String(q || '').trim().slice(0, 60);
    if (name.length < 2) return [];
    const r = await this.f(`${GEO}?name=${encodeURIComponent(name)}&count=6&language=en&format=json`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Place search failed (${r.status})`);
    const j = await r.json();
    return (j.results || []).map((x) => ({ name: [x.name, x.admin1, x.country_code].filter(Boolean).join(', '), lat: x.latitude, lon: x.longitude }));
  }

  /** loc = {lat, lon, name}. Returns normalized weather, from cache for 10 minutes; falls back to stale data when the network is down. */
  async get(loc) {
    if (!loc || loc.lat == null || loc.lon == null) return null;
    const key = `${loc.lat},${loc.lon}`;
    if (this.cache && this.cache.key === key && this.now() - this.cache.at < TTL) return this.cache.data;
    try {
      const url = `${FC}?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day` +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=4';
      const r = await this.f(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`Weather lookup failed (${r.status})`);
      const j = await r.json();
      const c = j.current || {}, d = j.daily || {};
      const day = c.is_day !== 0;
      const data = {
        name: loc.name || '',
        updated: this.now(),
        now: { temp: c.temperature_2m, feels: c.apparent_temperature, humidity: c.relative_humidity_2m, wind: c.wind_speed_10m, ...describe(c.weather_code, day) },
        days: (d.time || []).map((t, i) => ({ date: t, hi: d.temperature_2m_max[i], lo: d.temperature_2m_min[i], pop: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null, ...describe(d.weather_code[i], true) })),
      };
      this.cache = { key, at: this.now(), data };
      return data;
    } catch (e) {
      if (this.cache && this.cache.key === key) return { ...this.cache.data, stale: true };
      throw e;
    }
  }
}

module.exports = { Weather, describe };
