<template>
  <button type="button">{{ onLabel }}<slot /></button>
</template>
<script setup lang="ts">
defineProps<{ onLabel?: string }>();
</script>
