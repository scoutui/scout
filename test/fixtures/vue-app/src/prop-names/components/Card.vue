<template>
  <article :class="{ preview: isPreview }"><slot /></article>
</template>
<script setup lang="ts">
defineProps<{ isPreview?: boolean; onSelect?: () => void }>();
</script>
