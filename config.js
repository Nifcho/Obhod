// Настройки на приложението.
// apiUrl: адресът на уеб приложението от Google Apps Script (завършва на /exec).
// Докато е празен, отметките се пазят само на телефона.
window.OBHOD_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbyf7yG_vn-eKIYIiRsHXzA_z-Q67OVUhhJWNdKsB-wmONMBCvkofDsfPcpUn8ERmMjT/exec',
  pollSec: 10,
  // Търговски: отметките важат за една смяна и се нулират сами в този час (14 = 14:00).
  turgShiftHour: 14,
  drivers: ['Валентин', 'Влади', 'Тошко', 'Румен Евтимов', 'Лъчо', 'Ради']
};
