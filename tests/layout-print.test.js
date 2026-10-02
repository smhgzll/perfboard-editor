import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProjectStore } from '../js/model.js';
import { COMPONENT_CATALOG } from '../js/catalog.js';
import { PrintService } from '../js/print.js';
import { LayoutDrawing, rowLabel, printReferences, lineIntersectsBox, PRINT_PITCH, PRINT_MARGIN } from '../js/layout-print.js';

const fixture = name => {
  const raw = JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url)));
  const store = new ProjectStore(); store.load(raw.state || raw); return store;
};

test('print coordinates support letter rollover and numeric rows', () => {
  assert.deepEqual([0, 25, 26, 27, 51, 52].map(i => rowLabel(i)), ['A', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  assert.equal(rowLabel(27, 'numbersBoth'), '28');
});

test('short print references stay unique without stealing an existing project ID', () => {
  const components = [{ id: 'I1', name: 'U1_ADAU1701' }, { id: 'R1', name: 'R_PULLUP_2k2' }, { id: 'R2', name: 'R1 Duplicate' }, { id: 'X1', name: 'U1 Duplicate' }, { id: 'very-long-internal-reference', name: 'Very long full name' }];
  const refs = printReferences(components);
  assert.equal(refs.get('I1'), 'U1'); assert.equal(refs.get('R1'), 'R1'); assert.equal(refs.get('R2'), 'R2');
  assert.equal(new Set(refs.values()).size, components.length);
  assert.ok([...refs.values()].every(ref => ref.length <= 12));
});

test('all catalog pin coordinates survive print rendering on either face at every rotation', () => {
  for (const { kind } of COMPONENT_CATALOG) for (const rot of [0, 90, 180, 270]) {
    const store = new ProjectStore(); Object.assign(store.state.board, { cols: 40, rows: 40 });
    const component = store.addComponent(kind, 10, 10); component.rot = rot; component.side = rot % 180 ? 'bottom' : 'top';
    for (const face of ['top', 'bottom']) {
      const drawing = new LayoutDrawing(store, face), svg = drawing.build();
      const physical = face === component.side || !kind.startsWith('smd');
      assert.equal((svg.match(/data-pin="/g) || []).length, physical ? component.pins.length : 0);
      if (!physical) continue;
      for (const p of store.pinsFor(component)) {
        const expression = new RegExp(`<(?:rect|circle) class="layout-pin[^>]+data-pin="${component.id}:${p.pinIndex}"[^>]+>`);
        const tag = svg.match(expression)?.[0]; assert.ok(tag, `${kind} ${rot} ${face} pin ${p.pinIndex}`);
        const attr = name => Number(tag.match(new RegExp(`\\b${name}="([^\\"]+)"`))?.[1]);
        const x = tag.startsWith('<rect') ? attr('x') + 3.2 : attr('cx'), y = tag.startsWith('<rect') ? attr('y') + 3.2 : attr('cy');
        assert.ok(Math.abs(x - (PRINT_MARGIN + p.col * PRINT_PITCH)) < 0.01);
        assert.ok(Math.abs(y - (PRINT_MARGIN + p.row * PRINT_PITCH)) < 0.01);
        const visible = drawing.displayPoint(p);
        assert.ok(Math.abs(visible.x - (face === 'bottom' ? drawing.size.width - x : x)) < 0.01);
      }
    }
  }
});

test('print geometry does not change with editor display pitch or workspace margins', () => {
  const store = fixture('ADAU1701_perfboard_rev5_example.perfboard.json');
  const before = new LayoutDrawing(store).build();
  Object.assign(store.state.board, { pitchPx: 4, margin: 500 });
  assert.equal(new LayoutDrawing(store).build(), before);
});

test('hiding opposite-face bodies retains physical through-hole pin contacts', () => {
  const store = new ProjectStore(); const c = store.addComponent('dip8', 3, 3);
  const svg = new LayoutDrawing(store, 'bottom', { otherFace: false }).build();
  assert.doesNotMatch(svg, /data-component-id=/);
  assert.equal((svg.match(/data-pin="/g) || []).length, c.pins.length);
  assert.match(svg, /data-column="1"/);
});

test('wire junction dots reflect bare contacts rather than insulated crossings', () => {
  const store = new ProjectStore(); Object.assign(store.state.board, { cols: 5, rows: 5 });
  store.state.wires = [{ id: 'W1', layer: 'top', bridgeType: 'normal', route: [{ col: 0, row: 2 }, { col: 4, row: 2 }] }, { id: 'W2', layer: 'top', bridgeType: 'normal', route: [{ col: 2, row: 0 }, { col: 2, row: 4 }] }];
  assert.match(new LayoutDrawing(store).build(), /data-grid="2,2"/);
  store.state.wires[1].bridgeType = 'insulated';
  const svg = new LayoutDrawing(store).build();
  assert.doesNotMatch(svg, /data-grid="2,2"/); assert.match(svg, /class="layout-wire insulated"/);
  store.state.wires[1].layer = 'jumper';
  assert.doesNotMatch(new LayoutDrawing(store, 'bottom').build(), /data-wire-id="W2"/);
});

test('label collision detection checks actual segments including diagonal wires', () => {
  const box = { x: 10, y: 10, w: 10, h: 10 };
  assert.equal(lineIntersectsBox({ x: 0, y: 15 }, { x: 30, y: 15 }, box), true);
  assert.equal(lineIntersectsBox({ x: 0, y: 0 }, { x: 30, y: 30 }, box), true);
  assert.equal(lineIntersectsBox({ x: 0, y: 8 }, { x: 8, y: 30 }, box), false);
  assert.equal(lineIntersectsBox({ x: 15, y: 0 }, { x: 15, y: 30 }, box), true);
});

test('automatic print arrangement prioritizes readable refs and preserves explicit choices', () => {
  const store = fixture('ADAU1701_perfboard_rev5_example.perfboard.json'), printer = new PrintService(store, null);
  printer.layoutOptions.key = false; store.state.view.layoutPrintMode = 'auto';
  assert.equal((printer.buildLayoutDocument().match(/class="page layout-page/g) || []).length, 2);
  store.state.view.layoutPrintMode = 'two-up';
  assert.equal((printer.buildLayoutDocument().match(/class="page layout-page/g) || []).length, 1);
  Object.assign(store.state.board, { cols: 6, rows: 10 });
  assert.equal(printer.boardFitsTwoUp(), true);
});

test('parts keys preserve full names, values and board notes without mutating projects', () => {
  const store = fixture('ADAU1701_perfboard_rev5_example.perfboard.json');
  store.state.name = '<Board>'; store.state.components[0].value = '<script>alert(1)</script>';
  store.state.texts[0].text = 'Line 1\n<svg onload="alert(1)">';
  const before = JSON.stringify(store.state), printer = new PrintService(store, null), doc = printer.buildLayoutDocument();
  assert.match(doc, /&lt;Board&gt;/); assert.match(doc, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(doc, /<script>alert/); assert.doesNotMatch(doc, /<svg onload=/);
  assert.equal((doc.match(/data-key-id="/g) || []).length, store.state.components.length);
  assert.match(doc, /Line 1\n&lt;svg/);
  assert.equal(JSON.stringify(store.state), before);
});
