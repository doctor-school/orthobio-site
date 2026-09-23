import { describe, expect, it } from 'vitest';

import { matchSpecialty } from '../../src/lib/specialty';

const LIST = [
  { id: 'other', name: 'Другое' },
  { id: 'ortho', name: 'Травматология и ортопедия' },
  { id: 'sport', name: 'Спортивная медицина' },
  { id: 'rehab', name: 'Физическая и реабилитационная медицина' },
];

describe('matchSpecialty', () => {
  it('matches an exact name whatever the case and spacing', () => {
    expect(matchSpecialty(LIST, '  другое ')?.id).toBe('other');
    expect(matchSpecialty(LIST, 'травматология   и ортопедия')?.id).toBe('ortho');
  });

  it('resolves a fragment that occurs in exactly one name', () => {
    expect(matchSpecialty(LIST, 'ортопед')?.id).toBe('ortho');
    expect(matchSpecialty(LIST, 'Спорт')?.id).toBe('sport');
  });

  it('refuses a fragment shared by several names', () => {
    expect(matchSpecialty(LIST, 'медицина')).toBeNull();
  });

  it('refuses fragments shorter than four letters', () => {
    expect(matchSpecialty(LIST, 'дру')).toBeNull();
  });

  it('refuses a label that is not in the list', () => {
    expect(matchSpecialty(LIST, 'Другое / не медицинский работник')).toBeNull();
    expect(matchSpecialty(LIST, '')).toBeNull();
  });

  it('matches exact names only while the participant is still typing', () => {
    expect(matchSpecialty(LIST, 'ортопед', { allowFragment: false })).toBeNull();
    expect(matchSpecialty(LIST, 'Другое', { allowFragment: false })?.id).toBe('other');
  });
});
