<template>
  <Toggle :onLabel="'On'" :onClick="flip">Wi-Fi</Toggle>
</template>
<script setup lang="ts">
import Toggle from "../components/Toggle.vue";
function flip() {}
</script>
