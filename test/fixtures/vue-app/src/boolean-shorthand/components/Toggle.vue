<template>
  <button type="button" :aria-pressed="checked"><slot /></button>
</template>
<script setup lang="ts">
defineProps<{ checked?: boolean }>();
</script>
