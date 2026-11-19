import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { PLATFORM_NAME } from '../src/settings.js';

interface Property {
  type: string;
  default?: unknown;
  pattern?: string;
  oneOf?: Array<{ enum: string[] }>;
}

interface LayoutNode {
  key?: string;
  items?: Array<string | LayoutNode>;
}

const file = JSON.parse(readFileSync(new URL('../../config.schema.json', import.meta.url), 'utf8')) as {
  pluginAlias: string;
  schema: { properties: { printers: { items: { required?: string[]; properties: Record<string, Property> } } } };
  layout: Array<string | LayoutNode>;
};
const item = file.schema.properties.printers.items;
const pattern = (name: string) => new RegExp(item.properties[name].pattern!);

function layoutKeys(nodes: Array<string | LayoutNode>): string[] {
  return nodes.flatMap((node) => typeof node === 'string' ? [node] : [...(node.key ? [node.key] : []), ...layoutKeys(node.items ?? [])]);
}

describe('config.schema.json', () => {
  it('keeps the platform alias, so existing configs still load', () => {
    assert.equal(file.pluginAlias, PLATFORM_NAME);
  });

  it('requires nothing and sets no default inside a printer, so the blank first row is neither invalid nor saved', () => {
    assert.equal(item.required, undefined);
    for (const [name, property] of Object.entries(item.properties)) {
      assert.equal(property.default, undefined, name);
    }
  });

  it('shows every printer option in the layout, and only those', () => {
    const keys = layoutKeys(file.layout).filter((key) => key.startsWith('printers[].'));
    assert.deepEqual(keys.map((key) => key.slice('printers[].'.length)).sort(), Object.keys(item.properties).sort());
  });

  it('offers the X1 model', () => {
    assert.ok(item.properties.model.oneOf!.some((choice) => choice.enum.includes('X1')));
  });

  it('accepts IP addresses and host names, rejects URLs and ports', () => {
    for (const value of ['192.168.1.50', 'fe80::1', '[fd00::2]', 'x2d.local', 'printer']) {
      assert.match(value, pattern('ipAddress'));
    }
    for (const value of ['http://192.168.1.50', '192.168.1.50:322', '192.168.1.50 ', 'a b']) {
      assert.doesNotMatch(value, pattern('ipAddress'));
    }
  });

  it('checks the serial number, the access code and the stream URL', () => {
    assert.match('01S00C123456789', pattern('serialNumber'));
    assert.doesNotMatch('01S00C 123', pattern('serialNumber'));
    assert.match('12345678', pattern('lanAccessCode'));
    assert.match('aB3dE6gH', pattern('lanAccessCode'));
    assert.doesNotMatch('1234567', pattern('lanAccessCode'));
    assert.match('rtsp://192.168.1.60:8554/printer', pattern('cameraRtspUrl'));
    assert.match('rtsps://bblp:code@192.168.1.50:322/streaming/live/1', pattern('cameraRtspUrl'));
    assert.doesNotMatch('http://bridge/stream', pattern('cameraRtspUrl'));
  });
});
