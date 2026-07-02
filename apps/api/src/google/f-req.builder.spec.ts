import {
  buildHeaders,
  reqSearchCreativesByDomain,
  reqSearchCreativesByAdvertiser,
  reqGetCreativeById,
  reqSuggest,
} from './f-req.builder';

describe('f.req builder', () => {
  it('builds search-creatives-by-domain payload with required params field', () => {
    expect(reqSearchCreativesByDomain('nike.com')).toBe(
      '{"2":40,"3":{"12":{"1":"nike.com"}},"7":{"1":1,"2":30,"3":"1"}}',
    );
  });

  it('builds search-creatives-by-advertiser payload with advertiser filter', () => {
    expect(reqSearchCreativesByAdvertiser('AR123')).toBe(
      '{"2":40,"3":{"13":{"1":["AR123"]}},"7":{"1":1,"2":30,"3":"1"}}',
    );
  });

  it('includes page token (field 4) when provided', () => {
    expect(reqSearchCreativesByAdvertiser('AR123', 'TOKEN==')).toBe(
      '{"2":40,"3":{"13":{"1":["AR123"]}},"4":"TOKEN==","7":{"1":1,"2":30,"3":"1"}}',
    );
  });

  it('builds get-creative-by-id payload', () => {
    expect(reqGetCreativeById('AR123', 'CR456')).toBe(
      '{"1":"AR123","2":"CR456","5":{"1":1}}',
    );
  });

  it('builds suggest payload', () => {
    expect(reqSuggest('nike')).toBe('{"1":"nike","2":10,"3":10}');
  });

  it('provides a Chrome-like user-agent header', () => {
    const h = buildHeaders();
    expect(h['user-agent']).toContain('Chrome');
    expect(h['content-type']).toContain('application/x-www-form-urlencoded');
  });
});
