<template>
  <label>{{ label }}<input /></label>
</template>
<script setup lang="ts">
defineProps<{ label: string }>();
</script>
