"""Source-grounded VLA visual prototype, not yet an accepted plugin template.

Fixed synthetic entities; no user expressions, files, dataset or numerical recipe.
Run explicitly from a reviewed checkout with its ordinary Manim environment.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import tempfile

from manim_backend import (FPS, HEIGHT, WIDTH, _extract_gif, _make_overview,
                           prepare_output_dir)

MODES = ('sync', 'window', 'assemble')


def draw(mode: str, movie: Path) -> str:
    import manimpango
    from manim import (Circle, Dot, FadeIn, Line, Rectangle, RoundedRectangle,
                       Scene, Text, Transform, VGroup, linear, tempconfig)
    available = set(manimpango.list_fonts())
    configured = os.environ.get('GIF_CREATOR_MANIM_FONT')
    names = (configured,) if configured else ('Noto Sans CJK SC', 'Noto Sans SC',
        'Microsoft YaHei', 'WenQuanYi Zen Hei', 'Hiragino Sans GB', 'Heiti SC')
    font = next((name for name in names if name in available), None)
    if font is None:
        raise RuntimeError('An installed CJK Pango font is required')
    colors = ('#2676B8', '#148875', '#C37C32')
    ink, muted, line = '#182B36', '#566976', '#CAD3D7'

    class VLAScene(Scene):
        def construct(self):
            self.camera.background_color = '#F5F3EE'
            def text(label, size=22, color=ink):
                return Text(label, font=font, font_size=size, color=color)
            def robot(pose=0):
                # Poses distinguish synthetic camera observations, not predicted control.
                elbow = [-0.10 + pose * 0.08, 0.11 + pose * 0.05, 0]
                wrist = [0.26 + pose * 0.06, 0.24 - pose * 0.05, 0]
                return VGroup(Line([-0.35,-0.24,0],elbow,color=ink,stroke_width=4),
                    Line(elbow,wrist,color=ink,stroke_width=4),
                    Dot(elbow,radius=0.04,color=colors[0]),
                    Line(wrist,[wrist[0]+0.08,wrist[1]-0.12,0],color=ink),
                    Line(wrist,[wrist[0]-0.08,wrist[1]-0.12,0],color=ink),
                    Line([-0.50,-0.28,0],[-0.17,-0.28,0],color=ink),
                    Rectangle(width=0.16,height=0.14,color=muted).move_to([0.41,-0.22,0]))
            def tile(row, index, width=1.03):
                body=RoundedRectangle(width=width,height=0.70,corner_radius=0.06,
                    stroke_color=colors[row],stroke_width=1.7,
                    fill_color='#FFFFFF',fill_opacity=1)
                if row==0:
                    content=robot(index%3).scale(0.80)
                else:
                    # Abstract vector cells, deliberately no invented measured values.
                    content=VGroup(*[Rectangle(width=0.09,height=0.25,
                        fill_color=colors[row],fill_opacity=0.6,stroke_width=0)
                        .move_to([-0.25+i*0.17,0,0]) for i in range(4)])
                return VGroup(body,content)
            titles={'sync':'同一时刻，看什么？','window':'一段记录，取多窗','assemble':'片段怎样成样本？'}
            self.add(text(titles[mode],36).move_to([0,3.40,0]),
                text('合成示意 · 非真实采集或训练 recipe',18,muted).move_to([0,-3.55,0]))
            ys=[1.55,0.15,-1.25]
            xs=[-3.20+i*1.20 for i in range(6)]
            labels=['视觉 · K 路','状态','动作']
            self.add(text('episode A',20,muted).move_to([-3.05,2.65,0]))
            task=VGroup(RoundedRectangle(width=3.15,height=0.53,corner_radius=0.06,
                stroke_color=line,fill_color='#E8ECEC',fill_opacity=1),text('稳定任务上下文',19,muted))
            task.move_to([0,-2.67,0]);self.add(task)
            for row,y in enumerate(ys):
                self.add(text(labels[row],22,colors[row]).move_to([-5.75,y,0]),
                    Line([-4.0,y-0.48,0],[4.08,y-0.48,0],color=line,stroke_width=1))
            time_labels=[]
            for i,x in enumerate(xs):
                label=text(f't{i}',17,muted).move_to([x,2.15,0]);time_labels.append(label);self.add(label)
            tracks=[[tile(row,i).move_to([x,ys[row],0]) for i,x in enumerate(xs)] for row in range(3)]
            for track in tracks:self.add(*track)
            boundary=Line([3.50,1.97,0],[3.50,-1.88,0],color=muted,stroke_width=2)
            end_label=text('段结束',18,muted).move_to([4.15,-1.93,0]);self.add(boundary,end_label)
            caption=text({'sync':'三类记录，共用时间参考','window':'窗口可重叠，不跨段','assemble':'来源不变，逻辑重组'}[mode],23)
            caption.move_to([0,2.98,0]);self.add(caption)
            if mode=='sync':
                cursor=Line([xs[0],1.99,0],[xs[0],-1.91,0],color=colors[0],stroke_width=4)
                halo=VGroup(*[Rectangle(width=1.15,height=0.83,color=colors[r],stroke_width=3)
                    .move_to([xs[0],ys[r],0]) for r in range(3)])
                self.add(cursor,halo);self.wait(1,frozen_frame=False)
                self.play(cursor.animate.shift([1.20,0,0]),halo.animate.shift([1.20,0,0]),run_time=2,rate_func=linear)
                self.play(cursor.animate.shift([1.20,0,0]),halo.animate.shift([1.20,0,0]),run_time=2,rate_func=linear)
                self.play(Transform(caption,text('同帧对应，任务不变',23).move_to(caption)),run_time=1)
            elif mode=='window':
                def selection(center,color,opacity=1):
                    return Rectangle(width=3.55,height=4.04,color=color,stroke_width=3,
                        stroke_opacity=opacity).move_to([center,0.08,0])
                old=selection(-2.0,muted,0.35);active=selection(-2.0,colors[0]);self.add(old,active)
                # All tracks use a common reference; Nv/Na are symbolic, not equal-length claims.
                self.add(text('Nv / Na：各模态长度由样本规则确定',18,muted).move_to([0,-2.20,0]))
                self.wait(1,frozen_frame=False)
                self.play(active.animate.shift([2.40,0,0]),run_time=3,rate_func=linear)
                overlap=Rectangle(width=1.15,height=4.04,stroke_width=0,
                    fill_color=colors[0],fill_opacity=0.08).move_to([-0.8,0.08,0])
                self.play(FadeIn(overlap),run_time=1)
                self.play(Transform(caption,text('可重叠，不跨段',23).move_to(caption)),run_time=1)
            else:
                # Reserve a sample assembly space without squeezing source entities.
                self.remove(boundary,end_label,*time_labels[2:])
                self.remove(*[obj for track in tracks for obj in track])
                for row,track in enumerate(tracks):self.add(*track[:2])
                sample=RoundedRectangle(width=4.55,height=4.6,corner_radius=0.12,
                    stroke_color=line,stroke_width=2,fill_color='#FFFFFF',fill_opacity=0.5)
                sample.move_to([2.60,0.05,0]);self.add(sample,text('样本 · 同一 episode',22).move_to([2.60,2.43,0]))
                self.add(text('来自 t0',17,muted).move_to([1.45,2.04,0]),text('来自 t1',17,muted).move_to([2.65,2.04,0]))
                copies=[];animations=[]
                for row in range(3):
                    for index in range(2):
                        source=tracks[row][index];copy=source.copy();self.add(copy);copies.append(copy)
                        target=[1.45+index*1.2,ys[row],0]
                        animations.append(copy.animate.move_to(target))
                self.wait(1,frozen_frame=False)
                self.play(*animations,run_time=3,rate_func=linear)
                task_copy=task.copy();self.add(task_copy)
                self.play(task_copy.animate.move_to([2.60,-1.98,0]),run_time=1,rate_func=linear)
                self.play(Transform(caption,text('同段片段，组成样本',23).move_to(caption)),run_time=1)
            self.wait(2,frozen_frame=False)
    media=movie.parent/'manim-media'
    with tempconfig({'pixel_width':WIDTH,'pixel_height':HEIGHT,'frame_rate':FPS,
        'media_dir':str(media),'disable_caching':True,'format':'mov','transparent':True,
        'write_to_movie':True,'save_last_frame':False,'output_file':'vla-fixed','verbosity':'WARNING'}):
        scene=VLAScene();scene.render()
        rendered=Path(scene.renderer.file_writer.movie_file_path)
        if media.resolve() not in rendered.resolve().parents:raise RuntimeError('Unexpected movie location')
        shutil.copyfile(rendered,movie)
    return font


def render(mode: str, output: Path) -> dict:
    if mode not in MODES:raise ValueError('mode must be sync/window/assemble')
    output=prepare_output_dir(output)
    with tempfile.TemporaryDirectory(prefix='vla-manim-') as private:
        movie=Path(private)/'render.mov';font=draw(mode,movie)
        native,encoded=_extract_gif(movie,output/'animation.gif',8,2000)
        _make_overview(output/'animation.gif',output/'overview.png')
        metrics={'width':WIDTH,'height':HEIGHT,'durationMs':8000,'finalHoldMs':2000,
            'frameCount':encoded,'sourceFrameCount':native,'mode':mode,'synthetic':True,
            'font':font,'pluginIntegrated':False,'bytes':(output/'animation.gif').stat().st_size}
        (output/'metrics.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
        return metrics

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode',choices=MODES);parser.add_argument('output',type=Path)
    args=parser.parse_args();print(json.dumps(render(args.mode,args.output),ensure_ascii=False))
