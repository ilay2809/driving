// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { signCategoryFromCode, signImage, signPlaceholder } from './signImage';

describe('signImage', () => {
  it('derives the catalogue family from the code', () => {
    expect(signCategoryFromCode('135')).toBe('warning');
    expect(signCategoryFromCode('206')).toBe('mandatory');
    expect(signCategoryFromCode('302')).toBe('priority');
    expect(signCategoryFromCode('426')).toBe('prohibition');
    expect(signCategoryFromCode('501')).toBe('public_transport');
    expect(signCategoryFromCode('701')).toBe('signals');
    expect(signCategoryFromCode('901')).toBe('work_zone');
  });

  it('draws a placeholder shape with the code', () => {
    const stop = signPlaceholder('302');
    expect(stop.innerHTML).toContain('302');
    expect(stop.getAttribute('class')).toContain('priority');
    expect(signPlaceholder('402').innerHTML).toContain('<rect');
  });

  it('falls back to the placeholder when the image fails to load', () => {
    const el = signImage('302');
    const img = el.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/signs/302.svg');
    img.dispatchEvent(new Event('error'));
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('svg.sign-ph')).not.toBeNull();
    expect(el.classList.contains('fallback')).toBe(true);
  });
});
