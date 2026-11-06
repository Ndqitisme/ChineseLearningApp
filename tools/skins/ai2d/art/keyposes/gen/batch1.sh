#!/usr/bin/env bash
cd "$(dirname "$0")"
M=../../src/master.png; F=../../gen/face_hd_in.png; G=../guide/out
( ./codex_gen2.sh wave_ul p_wave_ul.txt $M $G/wave_ul_guide.png; ./codex_gen2.sh wave_ur p_wave_ur.txt $M $G/wave_ur_guide.png
  ./codex_gen2.sh head_yawm12 p_head_yawm12.txt $F $G/head_yawm12_guide.png; ./codex_gen2.sh head_pitchm15 p_head_pitchm15.txt $F $G/head_pitchm15_guide.png ) > batchA.out 2>&1 &
( ./codex_gen2.sh drag p_drag.txt $M $G/drag_guide.png; ./codex_gen2.sh land p_land.txt $M $G/land_guide.png
  ./codex_gen2.sh head_yawp12 p_head_yawp12.txt $F $G/head_yawp12_guide.png ) > batchB.out 2>&1 &
wait
echo BATCH_DONE
