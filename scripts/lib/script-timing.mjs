// Reconstructs the same block traversal order used by generate-audio.mjs, so
// segment offsets line up, and returns each block's start timestamp (the
// moment its first segment begins playing) via the ElevenLabs alignment.
// Also returns `segmentStartTimes`, the absolute start time of EACH segment
// within the block — needed so a key_moment's tagged events (each pinned to
// a segmentIndex) can be timed to the exact line that mentions them, not just
// to the start of the whole moment.
export function computeBlockStartTimes(script, alignment) {
  const {segmentOffsets, character_start_times_seconds} = alignment;

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
    segmentIndex += entry.block.segments.length;
    return {name: entry.name, startTime: segmentStartTimes[0], segmentStartTimes, moment: entry.moment};
  });
}
