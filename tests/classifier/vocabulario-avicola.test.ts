import { describe, it, expect } from 'vitest';
import { categorizeIndustry, getIndustryProfile } from '@/infrastructure/classifier/industry/industry-profile.js';

describe('perfil AVICULTURA — vocabulario de planta de alimento (G-03)', () => {
  const profile = getIndustryProfile('AVICULTURA');

  it('bachada y bachadas están en cipKeywords', () => {
    expect(profile.cipKeywords).toContain('bachada');
    expect(profile.cipKeywords).toContain('bachadas');
  });

  it('canjilón y canjilones están en cipKeywords', () => {
    expect(profile.cipKeywords).toContain('canjilón');
    expect(profile.cipKeywords).toContain('canjilones');
  });

  it('estiba y estiva (ambas ortografías) están en cipKeywords', () => {
    expect(profile.cipKeywords).toContain('estiba');
    expect(profile.cipKeywords).toContain('estiva');
    expect(profile.cipKeywords).toContain('estiba de harina');
  });

  it('marlo y marlo de maíz están en mpKeywords', () => {
    expect(profile.mpKeywords).toContain('marlo');
    expect(profile.mpKeywords).toContain('marlo de maíz');
  });

  it('despique y despicado están en cipKeywords', () => {
    expect(profile.cipKeywords).toContain('despique');
    expect(profile.cipKeywords).toContain('despicado');
  });
});

describe('categorizeIndustry — la palabra "faena" no reclasifica una ponedora como frigorífico', () => {
  it('empresa ponedora se clasifica como AVICULTURA sin "faena" en la descripción', () => {
    expect(categorizeIndustry('Avicultura de postura - granja de gallinas ponedoras')).toBe('AVICULTURA');
    expect(categorizeIndustry('Granja avícola de ponedoras Highline')).toBe('AVICULTURA');
  });

  it('empresa de faena/matadero/frigorífico NO es AVICULTURA (AVICOLA_NO_RE correcto)', () => {
    expect(categorizeIndustry('Empresa de faena avícola')).not.toBe('AVICULTURA');
    expect(categorizeIndustry('Frigorífico avícola San Miguel')).not.toBe('AVICULTURA');
    expect(categorizeIndustry('Matadero y distribuidora avícola')).not.toBe('AVICULTURA');
  });

  it('el término "faena" en VocabularioTenant (fin del ciclo del lote) no afecta categorizeIndustry', () => {
    // categorizeIndustry() recibe la descripción de la EMPRESA, no el contenido de sus docs.
    // Un comprobante de la ponedora que mencione "se faena el lote" no cambia la
    // categoría de la empresa: categorizeIndustry() no se re-ejecuta por comprobante.
    const empresaPonedora = 'Avicultura de postura - ponedoras Highline Brown';
    expect(categorizeIndustry(empresaPonedora)).toBe('AVICULTURA');
  });

  it('energyIsMP y fuelIsMP siguen en false para AVICULTURA (regresión CIP-02)', () => {
    const profile = getIndustryProfile('AVICULTURA');
    expect(profile.energyIsMP).toBe(false);
    expect(profile.fuelIsMP).toBe(false);
  });
});
