import { describe, expect, it } from 'vitest';
import { daylightFactor, moonDirection, skyColours, sunDirection, sunElevation } from './environment';

describe('time of day', () => {
  it('puts the sun high in the south at noon and below the horizon at night', () => {
    expect(sunElevation(12)).toBeGreaterThan(1);
    expect(sunElevation(0)).toBeLessThan(0);
    const noon = sunDirection(12);
    expect(noon[1]).toBeGreaterThan(0.8); // up
    expect(noon[2]).toBeGreaterThan(0); // towards +z = south
    const morning = sunDirection(8);
    expect(morning[0]).toBeGreaterThan(0); // east
    const evening = sunDirection(17);
    expect(evening[0]).toBeLessThan(0); // west
    const len = Math.hypot(noon[0], noon[1], noon[2]);
    expect(len).toBeCloseTo(1);
  });

  it('fades daylight through twilight', () => {
    expect(daylightFactor(12)).toBe(1);
    expect(daylightFactor(0)).toBe(0);
    const dusk = daylightFactor(18);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
    expect(moonDirection(0)[1]).toBeGreaterThan(0);
  });

  it('derives darker skies, no sun and longer fog at night and in bad weather', () => {
    const day = skyColours(12, 'clear');
    const night = skyColours(1, 'clear');
    expect(night.sunIntensity).toBe(0);
    expect(night.moonIntensity).toBeGreaterThan(0);
    expect(night.night).toBe(1);
    expect(day.night).toBe(0);
    expect(night.zenith.r + night.zenith.g + night.zenith.b).toBeLessThan(day.zenith.r + day.zenith.g + day.zenith.b);
    const fog = skyColours(12, 'fog');
    expect(fog.fogFar).toBeLessThan(day.fogFar);
    expect(fog.sunIntensity).toBeLessThan(day.sunIntensity);
    const rain = skyColours(12, 'rain');
    expect(rain.fogFar).toBeLessThan(day.fogFar);
    expect(rain.fogFar).toBeGreaterThan(fog.fogFar);
  });
});
