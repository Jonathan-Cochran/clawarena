import { app } from './app.js';

const port = Number(process.env.PORT ?? 3333);
app.listen(port, () => {
  console.log(`[clawarena] Node.js ${process.version}; listening on http://localhost:${port}`);
});
