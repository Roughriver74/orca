import { describe, expect, it } from 'vitest'
import { normalizeForSpeech } from './companion-tts-text-normalization'

describe('normalizeForSpeech', () => {
  it('strips headings, bullets, and bold while keeping the words', () => {
    expect(normalizeForSpeech('# Заголовок\n\n- пункт один\n- пункт два')).toBe(
      'Заголовок пункт один пункт два'
    )
    expect(normalizeForSpeech('Это **важно** и ещё раз __важно__.')).toBe(
      'Это важно и ещё раз важно.'
    )
  })

  it('drops fenced code blocks and tables entirely', () => {
    const text =
      'Смотри код:\n```js\nconst x = 1\n```\nи таблицу:\n| a | b |\n| - | - |\n| 1 | 2 |\nГотово.'
    const result = normalizeForSpeech(text)
    expect(result).not.toContain('const x')
    expect(result).not.toContain('|')
    expect(result).toBe('Смотри код: и таблицу: Готово.')
  })

  it('converts links to their text and unwraps short inline code, dropping long code', () => {
    expect(normalizeForSpeech('См. [документацию](https://example.com/docs).')).toBe(
      'См. документацию.'
    )
    expect(normalizeForSpeech('Запусти `pnpm test`.')).toBe('Запусти пи эн пи эм тест.')
    const longCode = 'a'.repeat(30)
    expect(normalizeForSpeech(`Код: \`${longCode}\` готов.`)).toBe('Код: готов.')
  })

  it('replaces bare URLs and filesystem paths with spoken placeholders', () => {
    expect(normalizeForSpeech('Открой https://example.com/page сейчас.')).toBe(
      'Открой ссылка в панели сейчас.'
    )
    expect(normalizeForSpeech('Файл лежит в /Users/evgenijsikunov/assistant/ideas/note.md.')).toBe(
      'Файл лежит в путь в панели.'
    )
    expect(normalizeForSpeech('Путь C:\\Users\\e\\file.txt сохранён.')).toBe(
      'Путь путь в панели сохранён.'
    )
  })

  it('keeps Silero single-asterisk intonation markers intact', () => {
    expect(normalizeForSpeech('Ты *сегодня* хочешь закончить отчёт?')).toBe(
      'Ты *сегодня* хочешь закончить отчёт?'
    )
    expect(normalizeForSpeech('**Важно**: ты *сегодня* готов?')).toBe('Важно: ты *сегодня* готов?')
  })

  it('expands the acceptance numbers_dates sentence with correct grammatical case', () => {
    expect(normalizeForSpeech('Встреча 21 октября в 14:30, бюджет 1 250 000 рублей.')).toBe(
      'Встреча двадцать первого октября в четырнадцать тридцать, бюджет один миллион двести пятьдесят тысяч рублей.'
    )
  })

  it('expands a simple counted noun with feminine agreement', () => {
    expect(normalizeForSpeech('Жди 2 минуты.')).toBe('Жди две минуты.')
    expect(normalizeForSpeech('Осталось 5 яблок.')).toBe('Осталось пять яблок.')
  })

  it('declines numbers after prepositions and keeps ungrouped thousands', () => {
    expect(normalizeForSpeech('Прошло 3 из 12 тестов.')).toBe('Прошло три из двенадцати тестов.')
    expect(normalizeForSpeech('Осталось 1500 строк.')).toBe('Осталось тысяча пятьсот строк.')
  })

  it.each([
    ['Из 1500 строк изменено 21.', 'Из тысячи пятисот строк изменено двадцать один.'],
    ['Сделал 2 коммита, осталась 1 задача.', 'Сделал два коммита, осталась одна задача.'],
    ['Встреча с 10 до 12.', 'Встреча с десяти до двенадцати.'],
    ['Работаю с 9:00 до 18:30.', 'Работаю с девяти ноль ноль до восемнадцати тридцати.'],
    ['К 15:00 закончу.', 'К пятнадцати ноль ноль закончу.'],
    ['Покрытие выросло до 85%.', 'Покрытие выросло до восьмидесяти пяти процентов.'],
    ['Скидка 21% на подписку.', 'Скидка двадцать один процент на подписку.'],
    ['Доля ошибок 2,5%.', 'Доля ошибок две целых пять десятых процента.'],
    ['Потрачено 250 ₽ из 1000.', 'Потрачено двести пятьдесят рублей из тысячи.'],
    ['Стоимость $20 в месяц.', 'Стоимость двадцать долларов в месяц.'],
    ['Выручка 5 млн руб. за квартал.', 'Выручка пять миллионов рублей за квартал.'],
    ['В 2024 году вышло 3 релиза.', 'В две тысячи двадцать четвёртом году вышло три релиза.'],
    [
      'Это было в 2025 г. Потом всё изменилось.',
      'Это было в две тысячи двадцать пятом году. Потом всё изменилось.'
    ],
    ['Дедлайн 25.10.2026.', 'Дедлайн двадцать пятого октября две тысячи двадцать шестого года.'],
    ['С 10 по 12 октября я в отпуске.', 'С десятого по двенадцатое октября я в отпуске.'],
    ['К 21 октября всё будет готово.', 'К двадцать первому октября всё будет готово.'],
    ['Это 1-й шаг, 2-я попытка и 3-е место.', 'Это первый шаг, вторая попытка и третье место.'],
    ['В 3-м квартале было лучше.', 'В третьем квартале было лучше.'],
    ['Подожди 5-10 минут.', 'Подожди от пяти до десяти минут.'],
    ['Нашёл ошибки в 3 файлах.', 'Нашёл ошибки в трёх файлах.'],
    ['Ошибка в 1 файле, ускорение в 2 раза.', 'Ошибка в одном файле, ускорение в два раза.'],
    ['Напомню через 21 минуту.', 'Напомню через двадцать одну минуту.'],
    ['Сравнил с 2 версиями.', 'Сравнил с двумя версиями.'],
    ['Работаю над 2 задачами.', 'Работаю над двумя задачами.'],
    ['Добавь по 2 строки и по 1 строке.', 'Добавь по две строки и по одной строке.'],
    ['О 5 задачах поговорим позже.', 'О пяти задачах поговорим позже.'],
    ['Около 21 000 пользователей.', 'Около двадцати одной тысячи пользователей.'],
    ['Пришло 1 сообщение.', 'Пришло одно сообщение.'],
    ['Через 1,5 часа.', 'Через одну целую пять десятых часа.'],
    ['Температура -5°.', 'Температура минус пять градусов.'],
    ['Обнови до версии 1.2.3.', 'Обнови до версии один точка два точка три.'],
    ['Шаг 3 из 7 выполнен на 75%.', 'Шаг три из семи выполнен на семьдесят пять процентов.'],
    ['Без 2 минут 12.', 'Без двух минут двенадцать.']
  ])('speaks the assistant phrase %j', (input, spoken) => {
    expect(normalizeForSpeech(input)).toBe(spoken)
  })

  it('re-stresses Russian dictionary words without breaking number agreement or Latin phrases', () => {
    const pronunciations = new Map([
      ['минуты', 'мин+уты'],
      ['замок на воротах', 'зам+ок на вор+отах'],
      ['worktree', 'вёрктри']
    ])
    expect(
      normalizeForSpeech(
        'Через 2 минуты worktree откроет замок на воротах, не незамок на воротах.',
        {
          pronunciations
        }
      )
    ).toBe('Через две мин+уты вёрктри откроет зам+ок на вор+отах, не незамок на воротах.')
  })

  it('collapses whitespace left behind by stripped markup', () => {
    expect(normalizeForSpeech('# Заголовок\n\n\nТекст   с   пробелами.')).toBe(
      'Заголовок Текст с пробелами.'
    )
  })
})
