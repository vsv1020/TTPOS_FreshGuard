import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'

// Vant components (on-demand)
import { 
  Button, NavBar, Tabbar, TabbarItem, Cell, CellGroup, 
  Field, Form, Popup, Dialog, Tag, Badge, List,
  PullRefresh, Toast, Empty, Loading, Collapse, CollapseItem,
  SwipeCell, ActionSheet, Picker, Steps, Step, Rate,
  Divider, TextEllipsis, FloatingBubble, Icon, Tab, Tabs,
  Checkbox, CheckboxGroup, Radio, RadioGroup, Stepper
} from 'vant'
import 'vant/lib/index.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// Register Vant components
const vantComponents = [
  Button, NavBar, Tabbar, TabbarItem, Cell, CellGroup,
  Field, Form, Popup, Dialog, Tag, Badge, List,
  PullRefresh, Toast, Empty, Loading, Collapse, CollapseItem,
  SwipeCell, ActionSheet, Picker, Steps, Step, Rate,
  Divider, TextEllipsis, FloatingBubble, Icon, Tab, Tabs,
  Checkbox, CheckboxGroup, Radio, RadioGroup, Stepper
]
vantComponents.forEach(c => app.use(c))

app.mount('#app')
