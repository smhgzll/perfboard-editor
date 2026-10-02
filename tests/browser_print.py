"""Print layout checks: python3 tests/browser_print.py (Playwright + Chrome).

External requests are blocked. If Poppler is installed, also checks real A4 PDF
pagination and renders a full-page preview into /tmp/perfboard-layout-clean.png.
"""
import json
import pathlib
import re
import shutil
import subprocess
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
server = subprocess.Popen(['node', '--input-type=module', '-e', "import {createAppServer} from './server.js';const s=createAppServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));"], cwd=ROOT, stdout=subprocess.PIPE, text=True)
try:
 url = 'http://127.0.0.1:' + server.stdout.readline().strip()
 with sync_playwright() as p:
  browser = p.chromium.launch(executable_path=shutil.which('google-chrome') or shutil.which('chromium'), headless=True, args=['--disable-dev-shm-usage'])
  page = browser.new_page(viewport={'width':1500,'height':1100}, accept_downloads=True)
  page.route('**/*', lambda request: request.continue_() if request.request.url.startswith(url) else request.abort())
  errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
  page.goto(url, wait_until='networkidle'); page.wait_for_function('!!window.perfboardEditor')
  def evaluate(code): return page.evaluate(code)
  def ready():
   page.wait_for_function('''()=>{const f=document.querySelector('#printPreviewFrame');return f?.contentDocument?.readyState==='complete'&&f.contentDocument.querySelector('.layout-drawing')&&!document.querySelector('#printNowBtn').disabled}''')
  def frame(): return page.locator('#printPreviewFrame').element_handle().content_frame()
  def load(name):
   raw = json.loads((ROOT / 'examples' / name).read_text())
   page.evaluate('(raw)=>{const a=perfboardEditor;a.modal.close();a.storage.replaceProject(raw);a.afterLoad();a.printer.showLayout()}',raw); ready()
  def toggle(key, value):
   page.locator(f'[data-layout-print="{key}"]').set_checked(value); ready()
  def arrangement(mode):
   page.select_option('#previewLayoutMode',mode); ready()
  def pdf(name, expected_pages):
   html = evaluate('perfboardEditor.printer.buildLayoutDocument()')
   output = browser.new_page(); output.set_content(html)
   output.pdf(path=name, prefer_css_page_size=True, print_background=True); output.close()
   if shutil.which('pdfinfo'):
    info = subprocess.check_output(['pdfinfo',name],text=True)
    assert int(re.search(r'Pages:\s+(\d+)',info)[1]) == expected_pages, info
    width,height = map(float,re.search(r'Page size:\s+([\d.]+) x ([\d.]+)',info).groups())
    assert abs(width-841.89)<2 and abs(height-595.28)<2

  load('ADAU1701_perfboard_rev5_example.perfboard.json')
  project_before = evaluate('JSON.stringify(perfboardEditor.store.state)')
  assert frame().locator('.layout-page').count() == 2
  assert frame().locator('[data-key-id]').count() == 39
  assert frame().locator('.layout-ref').count() == 78
  assert frame().locator('.layout-value').count() == 0
  assert frame().locator('.layout-pin-label').count() == 0
  assert frame().locator('.layout-component.other-face').count() == 39
  assert frame().locator('.layout-note').count() == 2
  assert 'REV5: 24.576 MHz' in frame().locator('.layout-key-note').inner_text()
  assert frame().locator('.toolbar').is_hidden()
  assert frame().evaluate('document.documentElement.scrollWidth<=innerWidth')
  # Coordinates outside the mirrored geometry remain upright and reversible.
  assert frame().evaluate('''()=>{const a=document.querySelector('[data-face="top"]'),b=document.querySelector('[data-face="bottom"]');return +a.querySelector('[data-column="1"]').getAttribute('x')<+a.querySelector('[data-column="31"]').getAttribute('x')&&+b.querySelector('[data-column="1"]').getAttribute('x')>+b.querySelector('[data-column="31"]').getAttribute('x')&&b.querySelector('.layout-ref-text').getCTM().a>0}''')
  print('PASS short refs, complete parts/notes keys, front/back distinction and readable mirrored coordinates',flush=True)

  result = evaluate('''()=>{const a=perfboardEditor,doc=document.querySelector('#printPreviewFrame').contentDocument,failures=[];for(const svg of doc.querySelectorAll('.layout-drawing'))for(const c of a.store.state.components)for(const p of a.store.pinsFor(c)){const node=[...svg.querySelectorAll('[data-pin]')].find(n=>n.getAttribute('data-pin')===`${c.id}:${p.pinIndex}`);if(!node)continue;const point=new DOMPoint(node.tagName==='rect'?+node.getAttribute('x')+3.2:+node.getAttribute('cx'),node.tagName==='rect'?+node.getAttribute('y')+3.2:+node.getAttribute('cy'));const actual=point.matrixTransform(node.getScreenCTM());const rawx=60+p.col*24,y=60+p.row*24,x=svg.dataset.face==='bottom'?svg.viewBox.baseVal.width-rawx:rawx;const expected=new DOMPoint(x,y).matrixTransform(svg.getScreenCTM());if(Math.hypot(actual.x-expected.x,actual.y-expected.y)>.1)failures.push(`${c.id} ${p.pinIndex}`)}return failures}''')
  assert not result, result
  assert frame().evaluate('''()=>[...document.querySelectorAll('.layout-ref-box')].every(box=>{const svg=box.closest('svg'),x=+box.getAttribute('x'),y=+box.getAttribute('y');return x>=0&&y>=0&&x+ +box.getAttribute('width')<=svg.viewBox.baseVal.width&&y+ +box.getAttribute('height')<=svg.viewBox.baseVal.height})''')
  print('PASS rendered pin positions match the project on both faces; reference boxes stay inside drawings',flush=True)

  toggle('values',True); assert frame().locator('.layout-value').count() == 78
  toggle('pinNames',True); assert frame().locator('.layout-pin-label').count()>100
  toggle('otherFace',False)
  assert frame().locator('[data-face="bottom"] .layout-component').count() == 0
  assert frame().locator('[data-face="bottom"] [data-pin]').count()>100
  toggle('monochrome',True)
  assert frame().evaluate('''()=>[...document.querySelectorAll('.layout-wire-line')].every(n=>getComputedStyle(n).stroke==='rgb(34, 34, 34)')''')
  toggle('key',False); assert frame().locator('.layout-key-page').count() == 0
  arrangement('two-up'); assert frame().locator('.layout-page').count() == 1
  arrangement('auto'); assert frame().locator('.layout-page').count() == 2
  assert evaluate('JSON.stringify(perfboardEditor.store.state)') == project_before
  print('PASS print options, monochrome output, automatic readability and no changes to project data',flush=True)

  toggle('values',False); toggle('pinNames',False); toggle('otherFace',True); toggle('key',True); toggle('monochrome',False)
  arrangement('separate')
  page.screenshot(path='/tmp/perfboard-print-layout-ui.png')
  pdf('/tmp/perfboard-layout-clean.pdf',4)
  if shutil.which('pdftotext'):
   output = subprocess.check_output(['pdftotext','-layout','/tmp/perfboard-layout-clean.pdf','-'],text=True)
   texts = [text for text in output.split('\f') if text.strip()]
   assert len(texts) == 4
   assert 'TOP' in texts[0] and 'BOTTOM' in texts[1]
   assert all('PARTSKEY' in re.sub(r'\s+','',text) for text in texts[2:])
   assert 'REV5: 24.576 MHz' in texts[-1]
  if shutil.which('pdftoppm'):
   subprocess.run(['pdftoppm','-f','1','-singlefile','-scale-to','1600','-png','/tmp/perfboard-layout-clean.pdf','/tmp/perfboard-layout-clean'],check=True)
  toggle('key',False); pdf('/tmp/perfboard-layout-drawings-only.pdf',2); toggle('key',True)
  with page.expect_popup() as popup:
   page.click('#openPrintWindowBtn')
  window = popup.value; window.wait_for_load_state()
  assert window.locator('.layout-page').count() == 2
  assert window.evaluate('window.opener===null')
  window.close()
  evaluate('perfboardEditor.store.state.view.face="bottom"')
  with page.expect_download() as download:
   evaluate('perfboardEditor.printer.downloadSvg()')
  exported = pathlib.Path(download.value.path()).read_text()
  assert 'class="layout-drawing"' in exported and 'data-face="bottom"' in exported
  assert re.search(r'<svg width="[\d.]+mm" height="[\d.]+mm"',exported)
  assert 'layout-ref-text' in exported and '<style>' in exported
  print('PASS real A4 PDF pagination, complete key values/notes, print window and physical SVG export',flush=True)

  page.keyboard.press('Escape'); assert not evaluate('document.querySelector(".modal-card").classList.contains("modal-print")')
  load('ADAU1701_LD1117_1V8_3V3_Regulator_compact_6x10_jumper.perfboard.json')
  assert frame().locator('.layout-page').count() == 1
  assert frame().locator('[data-key-id]').count() == 13
  pdf('/tmp/perfboard-layout-compact.pdf',2)
  page.screenshot(path='/tmp/perfboard-print-compact-clean.png')
  load('Stripboard_LED_indicator.perfboard.json')
  assert frame().locator('.copper-strip').count() == 11
  assert frame().locator('.copper-cut').count() == 1
  assert frame().locator('.solder-bridge').count() == 1
  assert frame().locator('[data-face="bottom"] .layout-wire.insulated').count() == 1
  print('PASS compact side-by-side drawing and accurate strip cuts, bridges and insulated wires',flush=True)

  # Custom numbering, bottom mounting, notes and rotation must also remain clear.
  evaluate('''()=>{const a=perfboardEditor;a.modal.close();a.newProject();const c=a.store.addComponent('dip8',2,2);c.side='bottom';c.rot=90;c.name='U1_Custom';c.value='<script>window.printExploit=1</script>';a.store.addText(2,10,'Safe <svg onload="alert(1)">');a.render();a.printer.showLayout()}'''); ready()
  assert frame().locator('[data-face="top"] .layout-component.other-face').count() == 1
  assert frame().locator('[data-face="bottom"] .layout-component.other-face').count() == 0
  assert frame().locator('script').count() == 0
  assert frame().evaluate('typeof window.printExploit') == 'undefined'
  assert '<script>window.printExploit=1</script>' in frame().locator('.layout-key-table').inner_text()
  page.set_viewport_size({'width':390,'height':844})
  assert evaluate('document.querySelector(".modal-card").scrollWidth<=document.querySelector(".modal-card").clientWidth')
  assert frame().evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.screenshot(path='/tmp/perfboard-print-mobile.png')
  page.keyboard.press('Escape'); assert not evaluate('document.querySelector(".app-shell").inert')
  assert not errors, errors
  print('PASS rotated bottom-mounted part, escaped text, mobile preview and modal cleanup without browser errors',flush=True)
  browser.close()
finally:
 server.terminate();server.wait(timeout=5)
