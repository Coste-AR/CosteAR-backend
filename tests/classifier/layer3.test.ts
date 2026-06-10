import { describe, it, expect } from 'vitest';
import { runLayer3 } from '@/infrastructure/classifier/layers/layer3-numeric-validation.js';

describe('runLayer3', () => {
  it('adds points for valid CUIT and valid CAE', () => {
    // 20-10000000-9 is a valid CUIT
    const text = 'CUIT: 20-10000000-9\nCAE Nº: 75123456789012\nFecha: 10/06/2026';
    const delta = runLayer3(text);
    // +10 (valid CUIT) + 12 (valid CAE) + 5 (reasonable date) = 27
    expect(delta).toBeGreaterThanOrEqual(22);
  });

  it('subtracts points for CUIT-formatted string with invalid verifier', () => {
    // 30-71234567-0 has wrong verifier
    const text = 'CUIT: 30-71234567-0';
    const delta = runLayer3(text);
    expect(delta).toBeLessThan(0);
  });

  it('subtracts points for CAE with wrong digit count', () => {
    const text = 'CAE Nº: 123456'; // too short
    const delta = runLayer3(text);
    expect(delta).toBeLessThanOrEqual(-15);
  });

  it('adds points for a date within the last 10 years', () => {
    const text = `Fecha: 01/01/${new Date().getFullYear()}`;
    const delta = runLayer3(text);
    expect(delta).toBeGreaterThanOrEqual(5);
  });

  it('subtracts points for a date too far in the past', () => {
    const text = 'Fecha: 01/01/1990';
    const delta = runLayer3(text);
    expect(delta).toBeLessThan(0);
  });

  it('returns 0 for text with no numeric structure', () => {
    const delta = runLayer3('texto libre sin numeros especiales');
    expect(delta).toBe(0);
  });
});
