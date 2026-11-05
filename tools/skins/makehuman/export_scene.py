"""Bake a Blender timeline without evaluating a growing action while posing the rig."""
import bpy


def save(rig,body,scene,frames,shots,apply_pose,output):
    rig.animation_data_clear()
    body.data.shape_keys.animation_data_clear()
    samples={}
    previous={}
    for i,(name,spec) in enumerate(frames.items()):
        apply_pose(rig,body,spec)
        pose={}
        for pb in rig.pose.bones:
            location,quaternion,scale=pb.matrix_basis.decompose()
            if pb.name in previous and quaternion.dot(previous[pb.name])<0:
                quaternion.negate()
            previous[pb.name]=quaternion.copy()
            pose[pb.name]=(tuple(location),tuple(quaternion),tuple(scale))
        samples[name]=(pose,tuple(body.data.shape_keys.key_blocks[k].value
                                  for k in ('mouth-corner-puller','mouth-open')))
        if i%20==0: print(f'[export] sampled {i+1}/{len(frames)} poses',flush=True)
    timeline=[]
    cursor=1
    scene.render.fps=30
    scene.timeline_markers.clear()
    for name,shot in shots.items():
        scene.timeline_markers.new(name,frame=cursor)
        timeline.append((cursor,'rest'));cursor+=2
        for frame,ms in shot:
            timeline.append((cursor,frame));cursor+=max(1,round((ms or 1000)*.03))
        timeline.append((cursor,'rest'));cursor+=15

    def curve(action,path,index,values,group):
        fc=action.fcurves.new(data_path=path,index=index,action_group=group)
        fc.keyframe_points.add(len(timeline))
        fc.keyframe_points.foreach_set('co',[v for (f,_),value in zip(timeline,values) for v in (f,value)])
        for p in fc.keyframe_points: p.interpolation='LINEAR'
        fc.update()

    action=bpy.data.actions.new('Tiểu Mai · all gestures · 30 fps')
    for pb in rig.pose.bones:
        pb.rotation_mode='QUATERNION'
        for property_index,(prop,size) in enumerate((('location',3),('rotation_quaternion',4),('scale',3))):
            for component in range(size):
                values=[samples[name][0][pb.name][property_index][component] for _,name in timeline]
                # Flip quaternion signs so consecutive keys take the short rotation path.
                if prop=='rotation_quaternion':
                    last=None;values=[]
                    for _,name in timeline:
                        q=list(samples[name][0][pb.name][1])
                        if last is not None and sum(a*b for a,b in zip(last,q))<0: q=[-v for v in q]
                        last=q;values.append(q[component])
                curve(action,pb.path_from_id(prop),component,values,pb.name)
    rig.animation_data_create().action=action
    expression=bpy.data.actions.new('Tiểu Mai · expressions')
    for index,unit in enumerate(('mouth-corner-puller','mouth-open')):
        key=body.data.shape_keys.key_blocks[unit]
        curve(expression,key.path_from_id('value'),0,[samples[name][1][index] for _,name in timeline],'Expressions')
    body.data.shape_keys.animation_data_create().action=expression
    scene.frame_end=cursor
    scene.frame_set(1)
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True);bpy.context.view_layer.objects.active=rig
    rig.show_in_front=True
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D': area.spaces.active.region_3d.view_perspective='CAMERA'
    output.mkdir(parents=True,exist_ok=True)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(output/'tieumai-reference.blend'))
    print(f'[export] saved {cursor} timeline frames, {len(samples)} source poses',flush=True)
