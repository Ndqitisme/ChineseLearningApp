<script lang="ts">
  /** Text that wraps between its phrases (after a comma, colon or semicolon, before "&" or "("), so a two-syllable word such as
   *  "ngày tháng" is not split across lines. Each phrase is an inline block: it stays whole when it fits the line and
   *  wraps inside itself only when it is longer than the line. */
  let { text }: { text: string } = $props();
  const parts = $derived(text.split(/(?<=[,;:]) | (?=& |\()/));
</script>

{#each parts as p, i (i)}{#if i}{' '}{/if}<span class:phrase={parts.length > 1}>{p}</span>{/each}

<style>
  .phrase { display: inline-block; }
</style>
