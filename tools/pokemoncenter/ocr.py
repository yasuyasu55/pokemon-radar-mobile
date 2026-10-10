"""Read ruled official schedule tables; fail on an unfamiliar layout.

Images and crops are temporary, never uploaded as evidence artifacts.
"""
import json
import os
import subprocess
import sys
import tempfile
from PIL import Image


def bands(values):
    out = []
    for value in values:
        if not out or value > out[-1][-1] + 1:
            out.append([value])
        else:
            out[-1].append(value)
    return out


def read_tables(filename):
    im = Image.open(filename).convert('L')
    w, h = im.size
    if w > 6000 or h > 6000:
        raise ValueError('画像サイズ上限')
    pixels = im.load()
    rows = bands(y for y in range(h) if sum(pixels[x, y] < 128 for x in range(w)) > w * .8)
    if not rows or len(rows) % 5 or len(rows) > 30:
        raise ValueError('4項目の表の罫線を特定できません')
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        def ocr(box, mode=7):
            image = os.path.join(tmp, 'cell.png')
            im.crop(box).save(image)
            args = ['tesseract', image, 'stdout', '-l', 'jpn', '--psm', str(mode)]
            if os.environ.get('TESSDATA_PREFIX'):
                args.extend(['--tessdata-dir', os.environ['TESSDATA_PREFIX']])
            run = subprocess.run(args, check=True, capture_output=True, text=True, timeout=30)
            return run.stdout.strip()

        previous_bottom = 0
        for start in range(0, len(rows), 5):
            group = rows[start:start + 5]
            top, bottom = group[0][0], group[-1][-1]
            cols = bands(x for x in range(w) if sum(pixels[x, y] < 128 for y in range(top, bottom + 1)) > (bottom-top)*.9)
            if len(cols) != 3:
                raise ValueError('2列の表を特定できません')
            labels, values, alternate = [], [], []
            title = ocr((0, previous_bottom, w, top-6))
            for i in range(4):
                y0, y1 = group[i][-1]+6, group[i+1][0]-6
                labels.append(ocr((cols[0][-1]+6, y0, cols[1][0]-6, y1)))
                box = (cols[1][-1]+6, y0, cols[-1][0]-6, y1)
                values.append(ocr(box))
                alternate.append(ocr(box, 6))
            results.append({'title': title, 'labels': labels, 'values': values, 'alternate': alternate})
            previous_bottom = bottom + 6
    return results


if __name__ == '__main__':
    print(json.dumps(read_tables(sys.argv[1]), ensure_ascii=False))
