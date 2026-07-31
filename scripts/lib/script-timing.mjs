// Reconstructs the same block traversal order used by generate-audio.mjs, so
// segment offsets line up, and returns each block's start timestamp (the
// moment its first segment begins playing) via the ElevenLabs alignment.
// Also returns `segmentStartTimes`/`segmentEndTimes`, the absolute start/end
// time of EACH segment within the block — needed so a key_moment's tagged
// events (each pinned to a segmentIndex) can be timed to the exact line that
// mentions them (not just the start of the whole moment), and so a graphic
// can stay on screen for as long as that line actually takes to say instead
// of a generic fixed duration.
export function computeBlockStartTimes(script, alignment) {
  const {segmentOffsets, character_start_times_seconds, character_end_times_seconds} = alignment;

  const blocks = [
    {name: 'hook', block: script.hook},
    ...script.key_moments.map((m, i) => ({name: `key_moments[${i}]`, block: m, moment: m})),
    ...(script.controversy ? [{name: 'controversy', block: script.controversy}] : []),
    {name: 'result', block: script.result},
    {name: 'outro', block: script.outro},
  ];

  let segmentIndex = 0;
  return blocks.map((entry) => {
    const segmentStartTimes = entry.block.segments.map(
      (_, k) => character_start_times_seconds[segmentOffsets[segmentIndex + k].start],
    );
    // `.end` is an exclusive character offset (one past the segment's last
    // character), matching slice semantics — so the segment's own last
    // character sits at index `end - 1`.
    const segmentEndTimes = entry.block.segments.map(
      (_, k) => character_end_times_seconds[segmentOffsets[segmentIndex + k].end - 1],
    );
    segmentIndex += entry.block.segments.length;
    return {
      name: entry.name,
      startTime: segmentStartTimes[0],
      segmentStartTimes,
      segmentEndTimes,
      moment: entry.moment,
    };
  });
}
