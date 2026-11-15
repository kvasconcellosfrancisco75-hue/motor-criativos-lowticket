import { Config } from "@remotion/cli/config";

// Navegador usado para renderizar. Em máquinas com Chrome instalado, basta remover esta linha.
if (process.env.CHROME_PATH) Config.setBrowserExecutable(process.env.CHROME_PATH);
Config.setVideoImageFormat("jpeg");
