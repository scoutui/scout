<template>
  <Card is-preview data-test="card" :on-select="pick">Draft</Card>
  <Field v-model="name" v-model:open="isOpen" />
  <Field v-model.trim="name" />
  <x-toggle v-model="isOpen" />
</template>
<script setup lang="ts">
import Card from "../components/Card.vue";
import Field from "../components/Field.vue";

const name = "";
const isOpen = false;
const pick = () => {};
</script>
