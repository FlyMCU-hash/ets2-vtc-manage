import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'

const app = createApp(App)
app.config.errorHandler = (err, _instance, info) => {
  console.error('[peak]', info, err)
}
app.use(createPinia()).mount('#app')
