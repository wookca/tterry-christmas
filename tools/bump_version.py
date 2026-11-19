# 업데이트할 때마다 실행: 브라우저가 예전 파일(캐시)을 쓰지 않도록 js·css 주소에 버전 번호를 붙임
#   python tools/bump_version.py
import json, os, re, time
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
v = time.strftime('%Y%m%d%H%M%S')
p = os.path.join(root, 'index.html')
s = open(p, encoding='utf-8').read()
imports = {'three': './lib/three.module.min.js', 'three/addons/': './lib/addons/'}
for f in sorted(os.listdir(os.path.join(root, 'js'))):
    if f.endswith('.js'):
        imports[f'./js/{f}'] = f'./js/{f}?v={v}'
block = '<script type="importmap">\n' + json.dumps({'imports': imports}, indent=2, ensure_ascii=False) + '\n  </script>'
s = re.sub(r'<script type="importmap">.*?</script>', lambda m: block, s, flags=re.S)
s = re.sub(r'<script type="module" src="js/main\.js[^"]*"></script>', f'<script type="module" src="js/main.js?v={v}"></script>', s)
s = re.sub(r'href="css/style\.css[^"]*"', f'href="css/style.css?v={v}"', s)
open(p, 'w', encoding='utf-8').write(s)
print('version', v)
