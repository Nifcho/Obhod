// Настройки на приложението.
// apiUrl: адресът на уеб приложението от Google Apps Script (завършва на /exec).
// Докато е празен, отметките се пазят само на телефона.
window.OBHOD_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbyf7yG_vn-eKIYIiRsHXzA_z-Q67OVUhhJWNdKsB-wmONMBCvkofDsfPcpUn8ERmMjT/exec',
  pollSec: 10,
  // Търговски: денят на наряда и отметките се сменят сами в този час (12 = 12:00) – след нощната смяна, преди следващата.
  turgShiftHour: 12,
  drivers: ['Валентин', 'Влади', 'Тошко', 'Румен Евтимов', 'Лъчо', 'Ради']
};
