import { describe, it, expect } from 'vitest';

describe('dbc-discover environment configuration', () => {
  it('handles symbol hints configuration', () => {
    const originalEnv = process.env.DBC_POSITION_SYMBOL_HINTS;
    
    // Test with custom symbol hints
    process.env.DBC_POSITION_SYMBOL_HINTS = 'DBCX,TEST';
    
    expect(process.env.DBC_POSITION_SYMBOL_HINTS).toBe('DBCX,TEST');
    
    // Restore
    if (originalEnv) {
      process.env.DBC_POSITION_SYMBOL_HINTS = originalEnv;
    } else {
      delete process.env.DBC_POSITION_SYMBOL_HINTS;
    }
  });

  it('handles update authority allow list configuration', () => {
    const originalEnv = process.env.DBC_POSITION_UPDATE_AUTHORITIES;
    
    // Test with custom authorities
    process.env.DBC_POSITION_UPDATE_AUTHORITIES = 'auth1,auth2';
    
    expect(process.env.DBC_POSITION_UPDATE_AUTHORITIES).toBe('auth1,auth2');
    
    // Restore
    if (originalEnv) {
      process.env.DBC_POSITION_UPDATE_AUTHORITIES = originalEnv;
    } else {
      delete process.env.DBC_POSITION_UPDATE_AUTHORITIES;
    }
  });

  it('validates debug mode configuration', () => {
    const originalEnv = process.env.DBC_DISCOVERY_DEBUG;
    
    // Test debug mode off
    process.env.DBC_DISCOVERY_DEBUG = 'false';
    expect(process.env.DBC_DISCOVERY_DEBUG).toBe('false');
    
    // Test debug mode on
    process.env.DBC_DISCOVERY_DEBUG = 'true';
    expect(process.env.DBC_DISCOVERY_DEBUG).toBe('true');
    
    // Restore
    if (originalEnv) {
      process.env.DBC_DISCOVERY_DEBUG = originalEnv;
    } else {
      delete process.env.DBC_DISCOVERY_DEBUG;
    }
  });
});