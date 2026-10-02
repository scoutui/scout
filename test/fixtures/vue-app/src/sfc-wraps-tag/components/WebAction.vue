<template>
  <web-button variant="primary" :size="size" @click="onClick"><slot /></web-button>
</template>
<script setup lang="ts">
defineProps<{ size?: string }>();
function onClick() {}
</script>
