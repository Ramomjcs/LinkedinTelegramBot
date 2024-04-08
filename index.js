const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");
const { executablePath } = require("puppeteer");

puppeteer.use(StealthPlugin());
require("dotenv").config();

const randomNumber = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const sendMessageTelegram = async (bot, chatId, message) => {
  let newMessage = message;
  // No Telegram, cada mensagem só pode ter até 4095 caracteres. Posso dividir em 2 mensagens também.
  if (message && message.length >= 4095) {
    const messageSplitted = message.split("\n\n");
    console.log("messageSplittado: ", messageSplitted);
    newMessage = messageSplitted[messageSplitted.length - 1];
  }

  bot
    .sendMessage(chatId, newMessage)
    .then((sentMessage) => {
      console.log("Mensagem enviada");
    })
    .catch((error) => {
      console.error("Erro ao enviar mensagem:", error);
    });
};

const sendPrintTelegram = async (bot, chatId, screenshotName, message) => {
  const pathImage = `/Users/ramomjcs/Documents/Codes/LinkedinTelegramBot/${screenshotName}`;
  bot
    .sendPhoto(chatId, pathImage)
    .then((sentMessage) => {
      console.log("Print enviado");
      sendMessageTelegram(bot, chatId, message);
      deleteScreenshot(pathImage);
    })
    .catch((error) => {
      console.error("Erro ao enviar print:", error);
    });
};

const deleteScreenshot = (filePath) => {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    console.error(`Erro ao remover o arquivo ${filePath}:`, error);
  }
};

const params = {
  headless: true, // False = Abre navegador
  executablePath: executablePath(),
};
puppeteer.launch(params).then(async (browser) => {
  // TELEGRAM
  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.CHAT_ID;
  const bot = new TelegramBot(token, { polling: true });

  // FUNÇÃO DELETAR TUDO
  bot.onText(/\/cls/, async (msg) => {
    const chatId = msg.chat.id;
    for (let i = 0; i < 101; i++) {
      bot.deleteMessage(chatId, msg.message_id - i).catch((er) => {
        return;
      });
    }
  });

  // VARIÁVEIS
  let screenshotOrder = 0;
  let tryTime = 1;
  let isFirstTime = true;
  let maxMinute = 5;

  console.log("Rodando...");
  while (true) {
    if (!isFirstTime) {
      const timeToNextRound = maxMinute * 60; // Em minutos
      await new Promise((resolve) => {
        let counter = 0;
        const intervalId = setInterval(() => {
          console.log(`Restam ${timeToNextRound - ++counter} segundos para nova rodada de buscas`);
          if (counter === timeToNextRound) {
            clearInterval(intervalId); // Limpa o intervalo após 30 segundos
            resolve(); // Resolve a promessa após 30 segundos
          }
        }, 1000); // Console a cada segundo
      });
    }
    console.log("Entrou no Loop");

    let findCorrectPage = false;
    // CONFIGURAÇÃO INICIAL
    const url = process.env.URL;
    let page = null;

    while (!findCorrectPage) {
      console.log("Inicia novo navegador");
      page = await browser.newPage();
      page.setDefaultNavigationTimeout(60000);

      console.log("Verificando página de login, tentativa: ", tryTime);
      await page.goto(url);
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const hasToastDiv = await page.evaluate(() => {
        const toastDiv = document.getElementById("toasts");
        return toastDiv !== null;
      });

      // Se não for página de login, encontrou a página correta
      if (hasToastDiv) {
        findCorrectPage = true;
        if (tryTime >= 10) {
          let additionalMinute = Math.floor(tryTime%10);
          maxMinute = maxMinute + additionalMinute;
        }
      } else {
        await page.close();
      }

      tryTime++;
    }
    console.log("\n Entrou na Página");

    const maxTime = randomNumber(15, 30); // Em segundos
    await new Promise((resolve) => {
      let counter = 0;
      const intervalId = setInterval(() => {
        console.log(`Restam ${maxTime - ++counter} segundos para acessar informações`);
        if (counter === maxTime) {
          clearInterval(intervalId); // Limpa o intervalo após 30 segundos
          resolve(); // Resolve a promessa após 30 segundos
        }
      }, 1000); // Console a cada segundo
    });

    console.log("\n");

    // Salva o HTML em um arquivo .txt
    let htmlContent = await page.content();
    // fs.writeFileSync('pagina.html', htmlContent, 'utf-8');

    //Obtém a lista de Vagas(elementos)
    const listaVagasTotal = await page.evaluate((html) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      const liElements = doc.querySelectorAll("li");
      const filteredElements = Array.from(liElements).filter((li) => {
        const divFilha = li.querySelector(
          ".base-card.relative.w-full.hover\\:no-underline.focus\\:no-underline.base-card--link.base-search-card.base-search-card--link.job-search-card"
        );
        if (divFilha) {
          const metadataDiv = divFilha.querySelector(".base-search-card__metadata");
          if (metadataDiv) {
            const timeElement = metadataDiv.querySelector("time");
            // const regex = /(?:minutes?|hours?|just now)/gi;
            const regex = /minutes?|just now/gi;
            if (timeElement && regex.test(timeElement.textContent)) {
              return true;
            }
          }
        }
        return false;
      });
      return filteredElements.map((li) => li.outerHTML);
    }, htmlContent);

    // Obtém um array com o texto de tempo de cada vaga encontrada
    let listaVagasRecentes = await page.evaluate((listaVagasTotal) => {
      const temposAndHrefsArray = [];
      listaVagasTotal.forEach((liHTML) => {
        const liDoc = new DOMParser().parseFromString(liHTML, "text/html");
        const timeElement = liDoc.querySelector(".job-search-card__listdate--new");
        const anchorElement = liDoc.querySelector("li > .base-card > a");
        if (timeElement && anchorElement) {
          const tempo = timeElement.textContent.trim();
          const href = anchorElement.getAttribute("href");
          temposAndHrefsArray.push({ tempo, href });
        }
      });

      return temposAndHrefsArray;
    }, listaVagasTotal);

    listaVagasRecentes = await listaVagasRecentes.filter((vaga) => {
      const splitted = vaga.tempo.split(" ");
      if (vaga.tempo === "Just now") {
        return true;
      } else if (Number(splitted[0]) <= maxMinute) {
        return true;
      }
      return false;
    });
    console.log(listaVagasRecentes);

    if (listaVagasRecentes.length > 0) {
      for (let i = 0; i < listaVagasRecentes.length; i++) {
        const currentJob = await listaVagasRecentes[i];

        await page.goto(currentJob.href);

        const maxTimeToPrint = randomNumber(15, 30);
        await new Promise((resolve) => {
          let counter = 0;
          const intervalId = setInterval(() => {
            console.log(`Restam ${maxTimeToPrint - ++counter} segundos para print`);
            if (counter === maxTimeToPrint) {
              clearInterval(intervalId); // Limpa o intervalo após 30 segundos
              resolve(); // Resolve a promessa após 30 segundos
            }
          }, 1000); // Console a cada segundo
        });

        // Clica no botão "Show more" e espera 5 segundos
        const showMoreButton = await page.$(".show-more-less-html__button");
        if (showMoreButton) {
          await showMoreButton.click({ delay: 1000 });
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
        console.log("Aguarde, tirando Print...");

        // Obtém texto da vaga
        console.log("\n");
        let textoVaga = await page.evaluate(() => {
          const descriptionText = document.querySelector(".description__text.description__text--rich");
          if (!descriptionText) return null;

          // Remove seções "Show less" e "Show more"
          let formattedText = descriptionText.innerHTML
            .trim()
            .replace(/<button[\s\S]*?show-more-less-html__button[\s\S]*?<\/button>/gi, "");

          // Substitui <br> por quebra de linha
          formattedText = formattedText.replace(/<br\s*\/?>/g, "\n");

          // Substitui <li> por quebra de linha e hífen
          formattedText = formattedText.replace(/<li\s*\/?>/g, "\n- ").replace(/<\/li\s*\/?>/g, "");

          // Remove todas as outras tags HTML
          formattedText = formattedText.replace(/<[^>]*>/g, "");

          // Remove <br> consecutivos no final
          formattedText = formattedText.replace(/(\n\s*)+$/, "");

          return formattedText;
        });
        textoVaga = textoVaga + "\n\n" + currentJob.href;
        console.log(textoVaga);
        console.log("\n");

        // Tira Print
        const clip = {
          x: 0, // Posição X inicial
          y: 50, // Posição Y inicial
          width: 800, // Largura da área a ser capturada 1128
          height: 1640, // Altura da área a ser capturada
        };

        await page.setViewport({
          width: 800, // HD: 1920, 4K: 3840
          height: 2160, // HD: 1080, 4K: 2160
          deviceScaleFactor: 1,
        });

        await page.screenshot({ path: `screenshot${screenshotOrder}.png`, clip });
        await sendPrintTelegram(bot, chatId, `screenshot${screenshotOrder}.png`, textoVaga);

        screenshotOrder++;
        console.log("\n\n");
      }
    }

    // Reseta tudo
    listaVagasRecentes = [];
    screenshotOrder = 0;
    isFirstTime = false;
  }
});
