"""Real WebGL checks. Run: python3 tests/browser_3d.py --babylon /path/to/babylon.js.

Without --babylon the viewer loads its normal Babylon CDN runtime. Every other
external request is blocked. Chrome uses software WebGL to work without a GPU.
"""
import argparse
import json
import pathlib
import shutil
import subprocess
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--babylon', type=pathlib.Path, help='Optional local copy of the Babylon CDN runtime')
args = parser.parse_args()
if args.babylon and not args.babylon.is_file():
 parser.error('Babylon runtime file does not exist')
server = subprocess.Popen(['node', '--input-type=module', '-e', "import {createAppServer} from './server.js';const s=createAppServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));"], cwd=ROOT, stdout=subprocess.PIPE, text=True)

try:
 url = 'http://127.0.0.1:' + server.stdout.readline().strip()
 with sync_playwright() as p:
  browser = p.chromium.launch(executable_path=shutil.which('google-chrome') or shutil.which('chromium'), headless=True, args=['--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
  page = browser.new_page(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
  errors = []
  page.on('pageerror', lambda error: errors.append(str(error)))
  allow_runtime = False
  def route(request):
   if request.request.url.startswith(url): request.continue_()
   elif request.request.url == 'https://cdn.babylonjs.com/babylon.js' and allow_runtime:
    if args.babylon: request.fulfill(path=str(args.babylon.resolve()), content_type='application/javascript')
    else: request.continue_()
   else: request.abort()
  page.route('**/*', route)
  page.goto(url, wait_until='networkidle')
  page.wait_for_function('!!window.perfboardEditor')
  def evaluate(code): return page.evaluate(code)
  def ready():
   page.wait_for_function('perfboardEditor.view3d.scene?.isReady() && document.querySelector(".view3d-loading").hidden', timeout=60000)
   evaluate('perfboardEditor.view3d.scene.render()')
  def load(name):
   raw = json.loads((ROOT / 'examples' / name).read_text())
   page.evaluate('(raw)=>{const a=perfboardEditor;a.modal.close();a.storage.replaceProject(raw);a.afterLoad()}', raw)
  def show():
   evaluate('perfboardEditor.view3d.show()'); ready()
  def toggle(key, enabled):
   page.locator(f'[data-option3d="{key}"]').set_checked(enabled)
  def assert_pins():
   result = evaluate('''()=>{const a=perfboardEditor,v=a.view3d,failures=[];for(const c of a.store.state.components){const root=v.scene.getTransformNodeByName(`part-${c.id}`);root.computeWorldMatrix(true);for(const p of a.store.pinsFor(c)){const anchor=v.scene.getTransformNodeByName(`pin-${c.id}-${p.pinIndex}`);anchor.computeWorldMatrix(true);const actual=anchor.getAbsolutePosition(),expected=v.gridTo3D(p.col,p.row);if(Math.hypot(actual.x-expected.x,actual.z-expected.z)>0.0001)failures.push(`${c.kind} ${c.rot} ${c.side} pin ${p.pinIndex}`)}}return failures}''')
   assert not result, result

  load('Stripboard_LED_indicator.perfboard.json')
  evaluate('perfboardEditor.view3d.show()')
  page.wait_for_selector('.view3d-loading.modal-error')
  assert evaluate('perfboardEditor.view3d.engine === null')
  assert 'Refresh' in page.locator('.modal-error').inner_text()
  allow_runtime = True
  page.click('#refresh3dBtn'); ready()
  assert evaluate('perfboardEditor.view3d.parts.length') == 4
  assert_pins()
  assert evaluate('perfboardEditor.view3d.scene.getMeshByName("perfboard").getTotalVertices()') > 1000
  assert evaluate('perfboardEditor.view3d.copperMeshes.filter(m=>m.name.startsWith("copper-")).length') == 11
  assert evaluate('perfboardEditor.view3d.scene.getMeshByName("pads-top").thinInstanceCount') == 120
  print('PASS offline failure, retry, real perforated board, strip cuts and pin alignment', flush=True)

  for view, beta in [('top', 0.015), ('bottom', 3.141592653589793 - 0.015), ('front', 3.141592653589793 / 2), ('perspective', 3.141592653589793 / 3.2)]:
   page.click(f'[data-view3d="{view}"]')
   assert abs(evaluate('perfboardEditor.view3d.camera.beta') - beta) < 1e-6
   assert page.locator(f'[data-view3d="{view}"]').get_attribute('aria-pressed') == 'true'
  assert evaluate('perfboardEditor.view3d.camera.lowerRadiusLimit') < 10
  for key, collection in [('parts', 'parts'), ('wires', 'wireMeshes'), ('copper', 'copperMeshes')]:
   toggle(key, False)
   assert evaluate(f'perfboardEditor.view3d.{collection}.every(m=>!m.isEnabled())')
   toggle(key, True)
   assert evaluate(f'perfboardEditor.view3d.{collection}.every(m=>m.isEnabled())')
  toggle('labels', True)
  assert evaluate('perfboardEditor.view3d.labels.every(m=>m.isEnabled())')
  toggle('labels', False)
  toggle('xray', True)
  assert evaluate('perfboardEditor.view3d.parts.every(p=>p.getChildMeshes().filter(m=>m.metadata.role!=="lead").every(m=>m.material.alpha<=0.28))')
  assert evaluate('perfboardEditor.view3d.parts.flatMap(p=>p.getChildMeshes()).filter(m=>m.metadata.role==="lead").every(m=>m.material.alpha===1)')
  toggle('xray', False)
  assert evaluate('perfboardEditor.view3d.parts.flatMap(p=>p.getChildMeshes()).every(m=>m.material===m._solidMaterial)')
  page.locator('#explode3d').evaluate('(input)=>{input.value="8";input.dispatchEvent(new Event("input",{bubbles:true}))}')
  assert evaluate('perfboardEditor.view3d.parts.every(p=>Math.abs(Math.abs(p.position.y)-8.8)<1e-6)')
  assert_pins()
  toggle('rotate', True)
  old_alpha = evaluate('perfboardEditor.view3d.camera.alpha')
  page.wait_for_timeout(500)
  assert evaluate('perfboardEditor.view3d.camera.alpha') != old_alpha
  page.click('[data-view3d="bottom"]')
  assert not page.locator('[data-option3d="rotate"]').is_checked()
  evaluate('perfboardEditor.view3d.scene.render()')
  assert abs(evaluate('perfboardEditor.view3d.camera.beta') - (3.141592653589793 - 0.015)) < 1e-6
  page.locator('#explode3d').evaluate('(input)=>{input.value="0";input.dispatchEvent(new Event("input",{bubbles:true}))}')
  evaluate('perfboardEditor.view3d.scene.render()')
  page.screenshot(path='/tmp/perfboard-3d-copper-bottom.png')
  print('PASS camera presets, zoom, layer switches, labels, reversible X-ray and lifted assembly', flush=True)

  page.click('[data-view3d="top"]')
  # Click the projected center of a body to exercise Babylon picking and the UI.
  target = evaluate('''()=>{const v=perfboardEditor.view3d,B=BABYLON;v.scene.render();const mesh=v.parts.find(p=>p.metadata.family==='resistor').getChildMeshes().find(m=>m.metadata.role==='body');const p=B.Vector3.Project(mesh.getBoundingInfo().boundingBox.centerWorld,B.Matrix.Identity(),v.scene.getTransformMatrix(),v.camera.viewport.toGlobal(v.engine.getRenderWidth(),v.engine.getRenderHeight()));const box=v.canvas.getBoundingClientRect();return {id:mesh.metadata.id,x:box.x+p.x*box.width/v.engine.getRenderWidth(),y:box.y+p.y*box.height/v.engine.getRenderHeight()}}''')
  page.mouse.click(target['x'], target['y'])
  assert evaluate('perfboardEditor.view3d.selectedId') == target['id']
  assert not page.locator('.view3d-selection').is_hidden()
  assert evaluate('perfboardEditor.view3d.parts.some(p=>p.getChildMeshes().some(m=>m.renderOutline))')
  with page.expect_download() as download:
   page.click('#save3dBtn')
  download.value.save_as('/tmp/perfboard-3d-export.png')
  assert pathlib.Path('/tmp/perfboard-3d-export.png').read_bytes()[:8] == b'\x89PNG\r\n\x1a\n'
  assert download.value.suggested_filename.endswith('-3d.png')
  print('PASS actual component picking, selection outline and PNG download', flush=True)

  # Rebuild releases the old context and keeps the user's camera position.
  evaluate('window.old3dEngine=perfboardEditor.view3d.engine;window.old3dScene=perfboardEditor.view3d.scene')
  old_radius = evaluate('perfboardEditor.view3d.camera.radius')
  page.click('#refresh3dBtn'); ready()
  assert evaluate('old3dScene.isDisposed && old3dEngine.isDisposed')
  assert abs(evaluate('perfboardEditor.view3d.camera.radius') - old_radius) < 1e-6
  if page.locator('#fullscreen3dBtn').is_visible():
   page.click('#fullscreen3dBtn'); page.wait_for_function('!!document.fullscreenElement')
   assert evaluate('document.fullscreenElement.classList.contains("viewer3d")')
   page.click('#fullscreen3dBtn'); page.wait_for_function('!document.fullscreenElement')
  evaluate('window.closed3dScene=perfboardEditor.view3d.scene;window.closed3dEngine=perfboardEditor.view3d.engine')
  page.keyboard.press('Escape')
  assert evaluate('closed3dScene.isDisposed && closed3dEngine.isDisposed && !perfboardEditor.view3d.engine')
  assert not evaluate('document.querySelector(".app-shell").inert')
  assert not evaluate('document.querySelector(".modal-card").classList.contains("modal-3d")')
  print('PASS refresh, full screen, closing and GPU resource disposal', flush=True)

  for name in ['ADAU1701_perfboard_rev5_example.perfboard.json', 'ADAU1701_LD1117_1V8_3V3_Regulator_compact_6x10_jumper.perfboard.json']:
   load(name); show(); assert_pins()
   assert evaluate('perfboardEditor.view3d.parts.length === perfboardEditor.store.state.components.length')
   if name.startswith('ADAU1701_perfboard'):
    page.screenshot(path='/tmp/perfboard-3d-upgraded.png')
  print('PASS both existing projects rendered with actual Babylon and preserved coordinates', flush=True)

  evaluate('''async()=>{const a=perfboardEditor;a.modal.close();a.newProject();Object.assign(a.store.state.board,{cols:60,rows:60});const {COMPONENT_CATALOG}=await import('/js/catalog.js');COMPONENT_CATALOG.forEach(({kind},i)=>{const c=a.store.addComponent(kind,2+i%7*8,2+Math.floor(i/7)*8);c.rot=i%4*90;c.side=i%2?'bottom':'top'});a.render()}''')
  show(); assert_pins()
  assert evaluate('perfboardEditor.view3d.parts.length') == 49
  assert evaluate('perfboardEditor.view3d.parts.every(p=>p.getChildMeshes().length>0 && Number.isFinite(p.metadata.height))')
  assert evaluate('perfboardEditor.view3d.parts.filter(p=>p.metadata.side<0).every(p=>p.getChildMeshes().filter(m=>m.metadata.role==="body").every(m=>{m.computeWorldMatrix(true);return m.getBoundingInfo().boundingBox.maximumWorld.y < -0.8}))')
  toggle('xray', True); toggle('xray', False)
  page.screenshot(path='/tmp/perfboard-3d-catalog.png')
  print('PASS all 49 catalog models, rotation and underside mounting in a real scene', flush=True)

  load('Stripboard_LED_indicator.perfboard.json')
  page.set_viewport_size({'width':390,'height':844}); show()
  assert evaluate('document.querySelector(".modal-3d").scrollWidth<=document.querySelector(".modal-3d").clientWidth')
  assert evaluate('perfboardEditor.view3d.canvas.clientWidth>300 && perfboardEditor.view3d.canvas.clientHeight>=240')
  page.click('[data-view3d="bottom"]')
  page.screenshot(path='/tmp/perfboard-3d-mobile.png')
  page.keyboard.press('Escape')
  assert not errors, errors
  print('PASS mobile preview and no JavaScript errors across the 3D workflows', flush=True)
  browser.close()
finally:
 server.terminate(); server.wait(timeout=5)
