/** Диагностика трекинга для debugView (разделяемый мутируемый объект, чтобы не менять TrackingState) */
export const trackingInfo = {
  camera: '',
  camFps: 0,             // реальная частота прихода VideoFrame (скользящее среднее), fps            // «640x480@30»
  read: 0, prep: 0, infer: 0, post: 0, // сглаженная разбивка цикла воркера, мс
  luma: 0, lowLight: false,
  synthL: false, synthR: false,
  synthPts: new Float32Array(4), // нормализованные x,y синтетических запястий L, R
  camLock: 'off' as 'off' | 'auto-ok' | 'locked' | 'unsupported', // режим ручной экспозиции камеры
  exposure: 0,           // текущий exposureTime (ед. камеры), 0 = авто/неизвестно
  brightness: 0,         // текущий brightness (ед. камеры)
  threads: 0,            // число потоков wasm
};
