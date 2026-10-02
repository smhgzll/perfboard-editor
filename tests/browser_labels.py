"""Check measured perfboard labels with dense examples (requires Playwright + Chrome)."""
import json
import pathlib
import shutil
import subprocess
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
server = subprocess.Popen(['node', '--input-type=module', '-e', "import {createAppServer} from './server.js';const s=createAppServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));"], cwd=ROOT, stdout=subprocess.PIPE, text=True)
url = f'http://127.0.0.1:{server.stdout.readline().strip()}'
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=shutil.which('google-chrome') or shutil.which('chromium'), headless=True, args=['--disable-dev-shm-usage'])
        page = browser.new_page(viewport={'width': 1600, 'height': 1000})
        page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(url) else route.abort())
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(url, wait_until='networkidle')
        page.wait_for_function('!!window.perfboardEditor')
        for fixture in ROOT.glob('examples/*.perfboard.json'):
            page.evaluate('(raw)=>{perfboardEditor.storage.replaceProject(raw);perfboardEditor.afterLoad()}', json.loads(fixture.read_text()))
            for zoom, font in [(0.5, 8.4), (1, 8.4), (2, 18)]:
                page.evaluate('''([zoom,font])=>{
                    const a=perfboardEditor;
                    Object.assign(a.store.state.view,{showLabels:true,showPinNames:true,labelFontSize:font,face:'both'});
                    a.selection={type:'component',id:a.store.state.components[0].id};
                    a.zoom=zoom;a.renderer.setZoom(zoom);a.render();
                }''', [zoom, font])
                result = page.evaluate('''()=>{
                    const svg=document.querySelector('#editorSvg');
                    const nodes=[...svg.querySelectorAll('.component-labels-layer text')];
                    const boxes=nodes.map(n=>n.getBBox());
                    const overlaps=[];
                    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
                        const a=boxes[i],b=boxes[j];
                        if(a.x<b.x+b.width && a.x+a.width>b.x && a.y<b.y+b.height && a.y+a.height>b.y)overlaps.push([i,j]);
                    }
                    const overlay=[...svg.querySelectorAll('.selected-label-overlay text')];
                    const selected=svg.querySelector('.component-annotations[data-id="'+perfboardEditor.selection.id+'"]');
                    return {count:nodes.length,overlaps,overlayMatches:overlay.every(n=>[...selected.querySelectorAll('text')].some(s=>s.textContent===n.textContent && s.getAttribute('x')===n.getAttribute('x') && s.getAttribute('y')===n.getAttribute('y'))),components:svg.querySelectorAll('.components-layer .component').length};
                }''')
                assert result['count'] > 0, (fixture.name, result)
                assert not result['overlaps'], (fixture.name, zoom, result)
                assert result['overlayMatches'], (fixture.name, result)
            page.evaluate('()=>{Object.assign(perfboardEditor.store.state.view,{showLabels:false,showPinNames:false});perfboardEditor.render()}')
            assert page.locator('.component-labels-layer text').count() == 0
            print(f'PASS {fixture.name}: labels and pin names do not overlap, selection and visibility work', flush=True)
        assert not errors, errors
        browser.close()
finally:
    server.terminate()
    server.wait(timeout=10)
