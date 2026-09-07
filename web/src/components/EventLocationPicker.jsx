'use client';

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';

// Map location picker with search + reverse geocoding (OpenStreetMap / Nominatim).
// Auto-fills Philippine address parts: Country, Region, Province, City, Barangay.
// value: { latitude, longitude, address, loc_country, loc_region, loc_province, loc_city, loc_barangay }
export default function EventLocationPicker({ value, onChange }) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const LRef = useRef(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);

  // Nominatim rarely fills `province` for a Philippine address, and its `state`
  // is the REGION ("Central Visayas"), not a province - so falling back to it
  // labelled Cebu City as "Central Visayas", and highly-urbanised cities came
  // back with nothing at all.
  //
  // The province does appear in `display_name`, sitting between the city and
  // the region: "Baseline Center, ..., Cebu City, Cebu, Central Visayas, 6000,
  // Philippines". So it is read from there when the structured field is absent.
  const norm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');

  // Highly-urbanised and independent component cities are politically separate
  // from any province, so OpenStreetMap has no province polygon over them: both
  // the street-level lookup AND a zoomed-out one return only the region, which
  // is why "Locate Me" left Province blank for Cebu City. The province each one
  // sits in is fixed, so it is resolved from the city name instead.
  const HUC_PROVINCE = {
    'angeles': 'Pampanga',
    'antipolo': 'Rizal',
    'bacolod': 'Negros Occidental',
    'baguio': 'Benguet',
    'butuan': 'Agusan del Norte',
    'cagayan de oro': 'Misamis Oriental',
    'cebu city': 'Cebu',
    'cotabato city': 'Maguindanao del Norte',
    'dagupan': 'Pangasinan',
    'davao city': 'Davao del Sur',
    'general santos': 'South Cotabato',
    'iligan': 'Lanao del Norte',
    'iloilo city': 'Iloilo',
    'isabela city': 'Basilan',
    'lapu-lapu': 'Cebu',
    'lucena': 'Quezon',
    'mandaue': 'Cebu',
    'naga': 'Camarines Sur',
    'olongapo': 'Zambales',
    'ormoc': 'Leyte',
    'puerto princesa': 'Palawan',
    'santiago': 'Isabela',
    'tacloban': 'Leyte',
    'zamboanga city': 'Zamboanga del Sur',
  };

  const provinceFromCity = (city) => {
    const key = norm(city).replace(/^city of /, '').replace(/ city$/, '');
    // Try the name as written first, then without the "City" suffix, so both
    // "Cebu City" and "Cebu" resolve while "Naga" still finds Camarines Sur.
    return HUC_PROVINCE[norm(city)] || HUC_PROVINCE[key] || HUC_PROVINCE[`${key} city`] || '';
  };

  const provinceFrom = (data, region, city) => {
    const a = data?.address || {};
    const direct = a.province || a.state_district || '';
    if (direct) return String(direct).trim();

    const parts = String(data?.display_name || '')
      .split(',').map((x) => x.trim()).filter(Boolean);
    const at = parts.findIndex((x) => norm(x) === norm(region));
    if (at > 0) {
      const candidate = parts[at - 1];
      // In Metro Manila the part before the region IS the city - those cities
      // sit directly under NCR and have no province above them.
      if (candidate && norm(candidate) !== norm(city) && !/^[\d\s-]+$/.test(candidate)) {
        return candidate;
      }
    }
    // NCR is how those addresses are actually written, so the region stands in
    // for the province there.
    if (/metro manila|national capital/i.test(region || '')) return region;
    // Otherwise fall back to the fixed province of a province-independent city.
    return provinceFromCity(city);
  };

  const parseAddress = (data = {}) => {
    const a = data.address || {};
    const region = a.region || a.state || '';
    const city = a.city || a.town || a.municipality || a.village || a.county || '';
    return {
      loc_country: a.country || '',
      loc_region: region,
      loc_province: provinceFrom(data, region, city),
      loc_city: city,
      loc_barangay: a.suburb || a.quarter || a.neighbourhood || a.village || a.hamlet || a.city_district || '',
    };
  };

  const reverseGeocode = async (lat, lng) => {
    setLoading(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lng}`, {
        headers: { 'Accept-Language': 'en' },
      });
      const data = await res.json();
      const parsed = parseAddress(data);
      onChange?.({
        latitude: lat, longitude: lng,
        address: data.display_name || '',
        ...parsed,
      });
    } catch {
      onChange?.({ latitude: lat, longitude: lng });
    }
    setLoading(false);
  };

  const placeMarker = (lat, lng, doReverse = true) => {
    const L = LRef.current;
    if (!L || !mapRef.current) return;
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      const icon = L.divIcon({
        className: 'evt-map-pin',
        html: '<i class="fas fa-map-marker-alt"></i>',
        iconSize: [30, 30], iconAnchor: [15, 30],
      });
      markerRef.current = L.marker([lat, lng], { draggable: true, icon }).addTo(mapRef.current);
      markerRef.current.on('dragend', (e) => {
        const p = e.target.getLatLng();
        reverseGeocode(p.lat, p.lng);
      });
    }
    mapRef.current.setView([lat, lng], Math.max(mapRef.current.getZoom(), 15));
    if (doReverse) reverseGeocode(lat, lng);
  };

  // Init map once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapEl.current || mapRef.current) return;
      LRef.current = L;
      const startLat = value?.latitude || 12.8797;
      const startLng = value?.longitude || 121.774;
      const map = L.map(mapEl.current).setView([startLat, startLng], value?.latitude ? 15 : 5);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
      }).addTo(map);
      map.on('click', (e) => placeMarker(e.latlng.lat, e.latlng.lng));
      mapRef.current = map;
      if (value?.latitude && value?.longitude) placeMarker(value.latitude, value.longitude, false);
      setTimeout(() => map.invalidateSize(), 200);
    })();
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markerRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locateMe = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      alert('Location is not supported by this browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        placeMarker(latitude, longitude, true);
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        alert(err.code === 1
          ? 'Location permission denied. Please allow location access and try again.'
          : 'Could not get your current location. Please try again or search instead.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const runSearch = async (e) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=ph&limit=6&q=${encodeURIComponent(query)}`, {
        headers: { 'Accept-Language': 'en' },
      });
      setResults(await res.json());
    } catch { setResults([]); }
    setSearching(false);
  };

  const pickResult = (r) => {
    setResults([]);
    setQuery(r.display_name);
    const lat = parseFloat(r.lat), lng = parseFloat(r.lon);
    placeMarker(lat, lng, false);
    onChange?.({ latitude: lat, longitude: lng, address: r.display_name, ...parseAddress(r) });
  };

  return (
    <div className="evt-loc-picker">
      <form className="evt-loc-search" onSubmit={runSearch}>
        <i className="fas fa-search"></i>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a place, address, or landmark…" />
        <button type="submit" className="btn-primary" disabled={searching}>{searching ? '…' : 'Search'}</button>
        <button type="button" className="evt-locate-btn" onClick={locateMe} disabled={locating} title="Use my current location">
          <i className={`fas ${locating ? 'fa-spinner fa-spin' : 'fa-location-crosshairs'}`}></i>
          <span>{locating ? 'Locating…' : 'Locate Me'}</span>
        </button>
      </form>
      {results.length > 0 && (
        <div className="evt-loc-results">
          {results.map((r) => (
            <button type="button" key={r.place_id} className="evt-loc-result" onClick={() => pickResult(r)}>
              <i className="fas fa-map-marker-alt"></i> {r.display_name}
            </button>
          ))}
        </div>
      )}

      <div ref={mapEl} className="evt-loc-map"></div>
      <p className="evt-loc-hint"><i className="fas fa-hand-pointer"></i> Click the map or drag the pin to set the exact spot. {loading && <span> · locating…</span>}</p>

      {/* The Country / Region / Province / City / Barangay readout used to be
          rendered here. It is intentionally gone - it was six boxes of noise
          the admin cannot edit anyway. The VALUES are still captured from the
          geocoder and still saved (see onChange in the parent); the parent now
          shows a single compact "Pinned location" summary instead. */}
    </div>
  );
}
