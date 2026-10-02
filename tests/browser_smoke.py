"""Optional end-to-end checks: python3 tests/browser_smoke.py (requires Playwright + Chrome)."""
import json
import pathlib
import shutil
import subprocess
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
server = subprocess.Popen(['node', '--input-type=module', '-e', "import {createAppServer} from './server.js';const s=createAppServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));"], cwd=ROOT, stdout=subprocess.PIPE, text=True)
url = f'http://127.0.0.1:{server.stdout.readline().strip()}'

def log(message): print(message, flush=True)

try:
 with sync_playwright() as p:
  browser = p.chromium.launch(executable_path=shutil.which('google-chrome') or shutil.which('chromium'), headless=True, args=['--disable-dev-shm-usage'])
  page = browser.new_page(viewport={'width': 1600, 'height': 1000})
  page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(url) else route.abort())
  errors = []
  page.on('pageerror', lambda e: errors.append(str(e)))
  page.goto(url, wait_until='networkidle')
  page.wait_for_function('!!window.perfboardEditor')
  def evaluate(code): return page.evaluate(code)
  def grid(col, row): return page.evaluate('''([col,row])=>{const svg=document.querySelector('#editorSvg');const p=svg.createSVGPoint(),b=perfboardEditor.store.state.board;p.x=b.margin+col*b.pitchPx;p.y=b.margin+row*b.pitchPx;const c=p.matrixTransform(svg.getScreenCTM());return {x:c.x,y:c.y}}''', [col,row])
  def click_grid(col,row,**kwargs):
   point=grid(col,row); page.mouse.click(point['x'],point['y'],**kwargs)
  def open_menu(index=0): page.locator('details.menu > summary').nth(index).click()
  def load_fixture(raw):
   page.evaluate('(raw)=>{perfboardEditor.storage.replaceProject(raw);perfboardEditor.afterLoad()}',raw);page.wait_for_timeout(150)
  def fresh(): evaluate('perfboardEditor.newProject()');page.wait_for_timeout(150)

  assert page.locator('[data-place]').count() == 49
  evaluate('window.originalBoardNode = document.querySelector("#editorSvg .board")')
  point=grid(4,4);page.mouse.move(point['x'],point['y'])
  assert evaluate('document.querySelector("#editorSvg .board") === window.originalBoardNode')
  page.fill('#paletteSearch','sot-223')
  assert page.locator('[data-place]').count() == 1
  page.fill('#paletteSearch','resistor')
  page.click('[data-place="resistor"]');click_grid(5,5);click_grid(12,6)
  assert evaluate('perfboardEditor.store.state.components.length') == 2
  assert evaluate('perfboardEditor.store.state.components.map(c=>c.name)') == ['R1','R2']
  page.keyboard.press('Escape');page.fill('#paletteSearch','')
  before=evaluate('perfboardEditor.store.history.length')
  page.locator('.component[data-id="R1"] .comp-body').click(force=True)
  assert evaluate('perfboardEditor.store.history.length') == before
  log('PASS palette search, repeated placement, names, selection without history noise')

  evaluate('''()=>{const a=perfboardEditor,c=a.store.componentById('R1');a.store.addWire([{col:c.col,row:c.row},{col:c.col,row:c.row+4}],{net:'SIGNAL'});a.render()}''')
  box=page.locator('.component[data-id="R1"] .comp-body').bounding_box();step=evaluate('perfboardEditor.zoom*perfboardEditor.store.state.board.pitchPx')
  page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down();page.mouse.move(box['x']+box['width']/2+step,box['y']+box['height']/2+step,steps=4);page.mouse.up()
  assert evaluate('perfboardEditor.store.componentById("R1").col') == 6
  assert evaluate('perfboardEditor.store.state.wires[0].route[0]') == {'col':6,'row':6}
  evaluate('perfboardEditor.select({type:"wire",id:"W1"})')
  handle=page.locator('[data-wire-handle="1"]').bounding_box()
  page.mouse.move(handle['x']+handle['width']/2,handle['y']+handle['height']/2);page.mouse.down();point=grid(4,10);page.mouse.move(point['x'],point['y'],steps=4);page.mouse.up()
  assert evaluate('perfboardEditor.store.wireById("W1").route[1]') == {'col':4,'row':10}
  log('PASS component drag preserves attached wire, wire handles edit routes')

  # Multi-select through the object list, then duplicate and undo as one action.
  page.click('[data-list-type="component"][data-id="R1"]')
  page.locator('[data-list-type="component"][data-id="R2"]').click(modifiers=['Shift'])
  assert evaluate('perfboardEditor.selections.length') == 2
  page.click('#duplicateGroupBtn')
  assert evaluate('perfboardEditor.store.state.components.length') == 4
  page.click('#undoBtn')
  assert evaluate('perfboardEditor.store.state.components.length') == 2
  log('PASS group selection, duplicate and undo')

  page.click('[data-tool="text"]');click_grid(8,12)
  page.fill('#noteText','Power supply\n3.3 V');page.click('#applyNoteBtn')
  assert page.locator('.note').text_content() == 'Power supply3.3 V'
  page.wait_for_timeout(650);page.reload(wait_until='networkidle')
  assert evaluate('perfboardEditor.store.state.texts[0].text') == 'Power supply\n3.3 V'
  assert page.locator('.note').count() == 1
  log('PASS note creation, editing and browser recovery')

  page.click('[data-page-target="board"]');page.fill('#boardCols','40');page.click('#applyBoardBtn');page.click('#undoBtn')
  assert evaluate('perfboardEditor.store.state.board.cols') == 30
  assert page.input_value('#boardCols') == '30'
  open_menu();page.click('#newProjectBtn')
  assert evaluate('perfboardEditor.store.state.components.length') == 0
  open_menu();page.click('#recoveryBtn');page.locator('[data-recovery]').first.click()
  assert evaluate('perfboardEditor.store.state.components.length') == 2
  assert page.locator('.note').count() == 1
  log('PASS synchronized undo, new-project archival and recovery')

  page.set_input_files('#fallbackFileInput', {'name':'bad.json','mimeType':'application/json','buffer':b'{"oops":true}'})
  page.wait_for_timeout(100)
  assert evaluate('perfboardEditor.store.state.components.length') == 2
  assert 'Invalid project' in page.locator('#statusBar').inner_text()
  log('PASS invalid import is transactional and reports an error')

  page.click('[data-page-target="library"]');page.click('#customComponentBtn')
  page.fill('#customName','Test module');page.fill('#customPinNumber','10');page.press('#customPinNumber','Tab')
  page.click('#saveCustomTemplateBtn')
  assert evaluate('perfboardEditor.store.state.customTemplates[0].pins[0].number') == '10'
  page.locator('#customTemplatePalette [data-template-index="0"]').click();click_grid(20,12);page.keyboard.press('Escape')
  assert evaluate('perfboardEditor.store.state.components.at(-1).pins[0].number') == '10'
  log('PASS custom template pin numbering and placement')

  open_menu();page.click('#examplesBtn');page.locator('[data-example*="rev5"]').click()
  page.wait_for_function('perfboardEditor.store.state.components.length === 39')
  assert evaluate('perfboardEditor.store.state.components.length') == 39
  assert page.locator('.note').count() == 1
  page.click('#runChecksBtn')
  assert page.locator('.check-result').count() > 0
  page.locator('.check-result').first.click()
  assert evaluate('perfboardEditor.selection !== null')
  log('PASS example chooser, restored legacy note and actionable checks')

  for button in ['#printLayoutBtn','#printSchematicBtn','#bomBtn']:
   open_menu(1);page.click(button)
   frame=page.frame_locator('#printPreviewFrame')
   assert frame.locator('body').inner_text()
   with page.expect_popup() as popup_info: page.click('#openPrintWindowBtn')
   popup=popup_info.value;popup.wait_for_load_state()
   assert len(popup.locator('body').inner_text()) > 100
   assert popup.evaluate('window.opener === null')
   popup.close();page.click('#modalCloseBtn')
  for button,extension in [('#csvBtn','.csv'),('#svgBtn','.svg')]:
   open_menu(1)
   with page.expect_download() as info:page.click(button)
   assert info.value.suggested_filename.endswith(extension)
   assert pathlib.Path(info.value.path()).stat().st_size > 100
  log('PASS print preview/windows and CSV/SVG downloads')

  # Saving uses the current file handle and writes the active project.
  evaluate('''()=>{window.savedProject=null;perfboardEditor.storage.fileHandle={name:'test.json',createWritable:async()=>({write:async text=>window.savedProject=JSON.parse(text),close:async()=>{}})}}''')
  page.click('#saveProjectBtn');page.wait_for_timeout(100)
  assert evaluate('savedProject.state.components.length') == 39
  assert evaluate('perfboardEditor.storage.dirty') is False
  page.click('#themeBtn');assert page.locator('body').evaluate("el=>el.classList.contains('light')")
  page.screenshot(path='/tmp/perfboard-light.png')
  page.click('#themeBtn')
  log('PASS file save and theme switching')

  page.click('#view3dBtn');page.wait_for_timeout(300)
  assert page.locator('.modal-error').count() == 1
  page.keyboard.press('Escape');assert not page.locator('#modal').is_visible()
  assert not page.locator('.app-shell').evaluate('el=>el.inert')
  log('PASS offline 3D failure and modal keyboard cleanup')

  for width in [1024,390]:
   page.set_viewport_size({'width':width,'height':844});page.wait_for_timeout(120)
   page.click('#centerBoardBtn');page.wait_for_timeout(250)
   assert evaluate('document.documentElement.scrollWidth') == width
   assert page.locator('#view3dBtn').is_visible()
   page.click('#toggleRightPanelBtn');assert page.locator('.right-panel').is_visible()
   page.click('#collapseRightPanelBtn');assert not page.locator('.right-panel').is_visible()
   if width==390:
    page.click('#toggleLeftPanelBtn');assert page.locator('.left-panel').is_visible()
    page.click('#collapseLeftPanelBtn');assert not page.locator('.left-panel').is_visible()
   page.screenshot(path=f'/tmp/perfboard-tested-{width}.png')
  assert not errors,errors
  log('PASS tablet/mobile drawers, viewport bounds; no browser exceptions')
  browser.close()
finally:
 server.terminate();server.wait()
