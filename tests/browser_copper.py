"""New copper/planning workflows: python3 tests/browser_copper.py."""
import json
import pathlib
import shutil
import subprocess
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
server = subprocess.Popen(['node', '--input-type=module', '-e', "import {createAppServer} from './server.js';const s=createAppServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));"], cwd=ROOT, stdout=subprocess.PIPE, text=True)

try:
 url = 'http://127.0.0.1:' + server.stdout.readline().strip()
 with sync_playwright() as p:
  browser = p.chromium.launch(executable_path=shutil.which('google-chrome') or shutil.which('chromium'), headless=True, args=['--disable-dev-shm-usage'])
  page = browser.new_page(viewport={'width': 1600, 'height': 1000})
  page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(url) else route.abort())
  errors = []
  page.on('pageerror', lambda error: errors.append(str(error)))
  page.goto(url, wait_until='networkidle')
  page.wait_for_function('!!window.perfboardEditor')
  def evaluate(code): return page.evaluate(code)
  def menu(index=0): page.locator('details.menu > summary').nth(index).click()
  def click_grid(col, row):
   point = page.evaluate('''([col,row])=>{const svg=document.querySelector('#editorSvg'),b=perfboardEditor.store.state.board,p=svg.createSVGPoint();p.x=b.margin+col*b.pitchPx;p.y=b.margin+row*b.pitchPx;const c=p.matrixTransform(svg.getScreenCTM());return {x:c.x,y:c.y}}''', [col,row])
   page.mouse.click(point['x'],point['y'])
  def copper_tool(tool):
   page.click('.copper-menu > summary'); page.click(f'[data-tool="{tool}"]')

  menu(); page.click('#examplesBtn'); page.click('[data-example="Stripboard_LED_indicator.perfboard.json"]')
  page.wait_for_function('perfboardEditor.store.state.board.type === "stripboard"')
  page.wait_for_timeout(200)
  assert page.locator('.copper-strip').count() == 11
  assert page.locator('.copper-cut').count() == 1
  assert page.locator('.solder-bridge').count() == 1
  assert page.locator('.connection-guide').count() == 1
  assert '1 open' in page.locator('#netCount').inner_text()
  page.screenshot(path='/tmp/perfboard-stripboard.png')
  page.click('[data-net-focus="LED_A"]')
  assert page.locator('.copper-net-highlight').count() == 2
  assert page.locator('.solder-bridge.net-highlight').count() == 1
  page.click('[data-net-focus="LED_A"]'); page.click('#centerBoardBtn'); page.wait_for_timeout(300)
  print('PASS original stripboard example, copper gaps, bridges and pending net guide', flush=True)

  guide = evaluate('perfboardEditor.networks.guides[0]')
  page.click('[data-route-guide]'); page.wait_for_timeout(400)
  assert evaluate('perfboardEditor.tool') == 'wire'
  click_grid(guide['b']['col'], guide['b']['row'])
  assert evaluate('perfboardEditor.store.state.wires.length') == 2
  assert page.locator('.connection-guide').count() == 0
  assert '0 open' in page.locator('#netCount').inner_text()
  page.select_option('#wireBridgeType','insulated'); page.click('#applyWireBtn')
  page.click('#runChecksBtn')
  assert page.locator('.check-result').count() == 0
  print('PASS guided manual routing completes the net and clears layout findings', flush=True)

  page.click('[data-list-type="component"][data-id="TP1"]')
  page.fill('[data-pin-net="0"]','MEASURE'); page.press('[data-pin-net="0"]','Tab')
  page.click('#runChecksBtn')
  assert 'NET CONFLICT' in page.locator('#checkResults').inner_text()
  page.click('#undoBtn')
  assert evaluate('perfboardEditor.store.componentById("TP1").pins[0].net') == '5V'
  page.click('#centerBoardBtn'); page.wait_for_timeout(300)
  print('PASS planned pin nets, physical conflict checks and undo', flush=True)

  copper_tool('cut'); click_grid(8.5,1)
  assert evaluate('perfboardEditor.store.state.board.cuts.length') == 0
  click_grid(8.5,1)
  assert evaluate('perfboardEditor.store.state.board.cuts.length') == 1
  click_grid(5.5,0)
  assert evaluate('perfboardEditor.store.state.board.cuts.length') == 2
  page.click('#undoBtn')
  assert evaluate('perfboardEditor.store.state.board.cuts.length') == 1
  copper_tool('solder'); click_grid(3,4); click_grid(3,5)
  assert evaluate('perfboardEditor.store.state.solderBridges.length') == 0
  click_grid(3,4); click_grid(3,5)
  assert evaluate('perfboardEditor.store.state.solderBridges.length') == 1
  click_grid(0,0); click_grid(2,0)
  assert 'neighboring' in page.locator('#statusBar').inner_text()
  assert evaluate('perfboardEditor.store.state.solderBridges.length') == 1
  page.keyboard.press('Escape')
  print('PASS cut/restore, solder bridge toggle, adjacency guard and undo', flush=True)

  page.click('[data-page-target="board"]')
  page.select_option('#stripDirection','vertical'); page.click('#applyBoardBtn')
  page.click('#runChecksBtn')
  assert 'INACTIVE CUT' in page.locator('#checkResults').inner_text()
  page.click('#undoBtn')
  assert page.input_value('#stripDirection') == 'horizontal'
  print('PASS copper direction changes preserve existing cuts and report inactive ones', flush=True)

  menu(); page.click('#notebookBtn')
  page.fill('#projectNotes','# Build notes\nMeasure LED current.\n<script>window.badNote=true</script>')
  page.fill('#newTaskText','Verify LED polarity'); page.press('#newTaskText','Enter')
  page.locator('[data-task-done]').last.check()
  assert evaluate('perfboardEditor.store.state.notebook.tasks.at(-1).done') is True
  with page.expect_download() as download: page.click('#exportNotesBtn')
  notes = pathlib.Path(download.value.path()).read_text()
  assert '- [x] Verify LED polarity' in notes and 'SB1' in notes
  page.keyboard.press('Escape'); page.wait_for_timeout(650)
  page.reload(wait_until='networkidle')
  assert evaluate('perfboardEditor.store.state.notebook.tasks.at(-1).done') is True
  assert 'Measure LED current' in evaluate('perfboardEditor.store.state.notebook.notes')
  assert evaluate('perfboardEditor.store.state.board.cuts.length') == 1
  assert evaluate('perfboardEditor.store.state.solderBridges.length') == 1
  print('PASS notebook autosave, checklist, Markdown export and reload', flush=True)

  menu(1)
  with page.expect_download() as download: page.click('#netlistBtn')
  netlist = json.loads(pathlib.Path(download.value.path()).read_text())
  assert netlist['format'] == 'perfboard-connectivity' and netlist['coordinateBase'] == 1
  assert netlist['missingConnections'] == [] and len(netlist['physicalIslands']) == 3
  menu(1); page.click('#assemblyBtn')
  frame = page.frame_locator('#printPreviewFrame')
  assert 'C1' in frame.locator('body').inner_text() and 'SB1' in frame.locator('body').inner_text()
  assert 'Verify LED polarity' in frame.locator('body').inner_text()
  assert '<script>window.badNote=true</script>' in frame.locator('body').inner_text()
  assert not page.frames[-1].evaluate('!!window.badNote')
  page.keyboard.press('Escape')
  menu(1); page.click('#printLayoutBtn')
  assert page.frame_locator('#printPreviewFrame').locator('.copper-cut').count() == 1
  assert page.frame_locator('#printPreviewFrame').locator('.solder-bridge').count() == 1
  page.keyboard.press('Escape')
  print('PASS connection export, escaped assembly worksheet and mirrored copper print', flush=True)

  page.click('.copper-menu > summary'); page.click('#copperPlanBtn')
  assert page.locator('.copper-step').count() == 2
  page.click('[data-copper-remove="0"]')
  assert evaluate('perfboardEditor.store.state.board.cuts.length') == 0
  page.keyboard.press('Escape'); page.click('#undoBtn')
  assert evaluate('perfboardEditor.store.state.board.cuts.length') == 1
  print('PASS copper work plan removal and undo', flush=True)

  for width in [1024,390]:
   page.set_viewport_size({'width':width,'height':844}); page.click('#centerBoardBtn'); page.wait_for_timeout(250)
   assert evaluate('document.documentElement.scrollWidth') == width
   copper_tool('solder'); assert evaluate('perfboardEditor.tool') == 'solder'; page.keyboard.press('Escape')
   page.click('#toggleRightPanelBtn'); assert page.locator('#netPanel').is_visible()
   page.click('#collapseRightPanelBtn')
   menu(); page.click('#notebookBtn')
   assert page.locator('#projectNotes').is_visible()
   assert page.locator('.modal-body').evaluate('el=>el.scrollWidth <= el.clientWidth')
   page.keyboard.press('Escape')
   page.screenshot(path=f'/tmp/perfboard-copper-{width}.png')
  assert not errors, errors
  print('PASS tablet/mobile copper tools, connection plan and notebook; no browser exceptions', flush=True)
  browser.close()
finally:
 server.terminate(); server.wait()
