const ELEVATION_PROVIDERS = [
  {
    name: 'NRCan CDEM',
    buildUrl(lat, lng) {
      // Documentation (which still shows HTTP, although the service now requires HTTPS):
      // https://natural-resources.canada.ca/science-data/data-analysis/geospatial-data-tools-services/elevation-api
      const url = new URL('https://geogratis.gc.ca/services/elevation/cdem/altitude');
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lng));
      return url;
    },
    read(payload) {
      return payload.altitude;
    }
  },
  {
    name: 'Open-Meteo',
    buildUrl(lat, lng) {
      const url = new URL('https://api.open-meteo.com/v1/elevation');
      url.searchParams.set('latitude', String(lat));
      url.searchParams.set('longitude', String(lng));
      return url;
    },
    read(payload) {
      return Array.isArray(payload.elevation) ? payload.elevation[0] : payload.elevation;
    }
  }
];

export async function lookupElevation(lat, lng, fetchImpl = fetch) {
  const failures = [];

  for (const provider of ELEVATION_PROVIDERS) {
    const url = provider.buildUrl(lat, lng);
    try {
      const response = await fetchImpl(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const value = Number.parseFloat(provider.read(await response.json()));
      if (Number.isFinite(value)) {
        return { elevation: value, provider: provider.name };
      }
      throw new Error('response contained no numeric elevation');
    } catch (error) {
      failures.push(`${provider.name}: ${error.message}`);
    }
  }

  throw new Error(failures.join('; '));
}
