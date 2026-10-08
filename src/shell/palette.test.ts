import { describe, expect, it } from 'vitest';
import { CATALOG, CATEGORIES } from '../catalog/services';
import { isServiceName } from '../components/NodeEditModal';
import { PALETTE, searchComponents } from './palette';

const ids = (q: string) => searchComponents(q).map((c) => c.awsIcon);

describe('component catalog', () => {
  it('is broad, with unique ids and labels, and every service in a known category', () => {
    expect(CATALOG.length).toBeGreaterThan(90);
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(CATALOG.length);
    expect(new Set(CATALOG.map((c) => c.label)).size).toBe(CATALOG.length);
    for (const c of CATALOG) expect(CATEGORIES).toContain(c.category);
  });
  it('finds components by what they do, not only by name', () => {
    expect(ids('monitoring')).toEqual(expect.arrayContaining(['cloudwatch', 'xray', 'grafana']));
    expect(ids('security')).toEqual(expect.arrayContaining(['waf', 'kms', 'iam', 'guardduty']));
    expect(ids('queue')).toEqual(expect.arrayContaining(['sqs']));
    expect(ids('encryption')[0]).toBe('kms');
    expect(ids('upload')).toContain('s3');
  });
  it('ranks a name match first and returns nothing for nonsense', () => {
    expect(ids('lambda')[0]).toBe('lambda');
    expect(ids('zzzzqqq')).toEqual([]);
    expect(searchComponents('')).toHaveLength(PALETTE.length);
  });
});

describe('renaming with the service', () => {
  it('a name that only repeats a service name follows it; a chosen name does not', () => {
    expect(isServiceName('CloudFront CDN')).toBe(true);
    expect(isServiceName('CloudFrontCDN')).toBe(true);
    expect(isServiceName('EC2 Instance')).toBe(true);
    expect(isServiceName('Orders')).toBe(false);
    expect(isServiceName('Checkout service')).toBe(false);
  });
});
