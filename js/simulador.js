(function () {
  const REGIONS = {
    N:  { name: 'Norte',        hsp: 4.85, tarifa: 0.96 },
    NE: { name: 'Nordeste',     hsp: 5.55, tarifa: 0.90 },
    CO: { name: 'Centro-Oeste', hsp: 5.20, tarifa: 0.88 },
    SE: { name: 'Sudeste',      hsp: 4.95, tarifa: 0.92 },
    S:  { name: 'Sul',          hsp: 4.45, tarifa: 0.84 }
  };

  const UF_TO_REGION = {
    AC: 'N', AP: 'N', AM: 'N', PA: 'N', RO: 'N', RR: 'N', TO: 'N',
    AL: 'NE', BA: 'NE', CE: 'NE', MA: 'NE', PB: 'NE', PE: 'NE', PI: 'NE', RN: 'NE', SE: 'NE',
    DF: 'CO', GO: 'CO', MT: 'CO', MS: 'CO',
    ES: 'SE', MG: 'SE', RJ: 'SE', SP: 'SE',
    PR: 'S', RS: 'S', SC: 'S'
  };

  const TAXA_MINIMA_KWH = {
    mono: 30,
    bi: 50,
    tri: 100
  };

  const FATOR_TELHADO = {
    ceramico: 1.00,
    fibrocimento: 1.04,
    laje: 1.12
  };

  let lastChartData = null;

  function formatBRL(value) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function detectRegionFromCepPrefix(cepDigits) {
    if (!cepDigits || cepDigits.length < 1) return null;
    const first = parseInt(cepDigits[0], 10);
    const two = cepDigits.length >= 2 ? parseInt(cepDigits.slice(0, 2), 10) : null;
    if (first >= 0 && first <= 3) return 'SE';
    if (first === 4 || first === 5) return 'NE';
    if (first === 6) {
      if (two !== null && two >= 66) return 'N';
      return 'NE';
    }
    if (first === 7) {
      if (two !== null && (two === 76 || two === 77)) return 'N';
      return 'CO';
    }
    if (first === 8 || first === 9) return 'S';
    return null;
  }

  function getCostPerKwp(kwp) {
    if (kwp <= 2.5) return 4100;
    if (kwp <= 5.0) {
      return 4100 - ((kwp - 2.5) / 2.5) * (4100 - 3150);
    }
    if (kwp <= 9.0) {
      return 3150 - ((kwp - 5.0) / 4.0) * (3150 - 2750);
    }
    return 2650;
  }

  function syncInputAndRange(numberId, rangeId) {
    const numEl = document.getElementById(numberId);
    const rangeEl = document.getElementById(rangeId);
    if (!numEl || !rangeEl) return;

    numEl.addEventListener('input', function () {
      const val = parseFloat(numEl.value);
      if (!isNaN(val)) {
        rangeEl.value = Math.min(parseFloat(rangeEl.max), Math.max(parseFloat(rangeEl.min), val));
      }
      calcularSimulacao();
    });

    rangeEl.addEventListener('input', function () {
      numEl.value = rangeEl.value;
      calcularSimulacao();
    });
  }

  function setupCepLookup() {
    const cepInput = document.getElementById('cep');
    const regiaoSelect = document.getElementById('regiao');
    const statusEl = document.getElementById('cep-status');
    if (!cepInput || !regiaoSelect || !statusEl) return;

    let lastQueried = '';

    cepInput.addEventListener('input', function () {
      let digits = cepInput.value.replace(/\D/g, '').slice(0, 8);
      if (digits.length > 5) {
        cepInput.value = digits.slice(0, 5) + '-' + digits.slice(5);
      } else {
        cepInput.value = digits;
      }

      if (digits.length === 8 && digits !== lastQueried) {
        lastQueried = digits;
        const fallbackReg = detectRegionFromCepPrefix(digits);
        if (fallbackReg) {
          regiaoSelect.value = fallbackReg;
          calcularSimulacao();
        }

        statusEl.textContent = 'Buscando localização...';
        statusEl.className = 'cep-status';

        fetch('https://viacep.com.br/ws/' + digits + '/json/')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data && !data.erro && data.uf) {
              const reg = UF_TO_REGION[data.uf] || fallbackReg || 'SE';
              regiaoSelect.value = reg;
              statusEl.textContent = data.localidade + ' - ' + data.uf + ' (' + REGIONS[reg].name + ')';
              statusEl.className = 'cep-status ok';
              calcularSimulacao();
            } else {
              statusEl.textContent = 'CEP não encontrado. Usando região selecionada.';
              statusEl.className = 'cep-status err';
            }
          })
          .catch(function () {
            if (fallbackReg) {
              statusEl.textContent = 'Região estimada pelo CEP: ' + REGIONS[fallbackReg].name;
              statusEl.className = 'cep-status ok';
            } else {
              statusEl.textContent = '';
            }
          });
      } else if (digits.length < 8) {
        statusEl.textContent = '';
      }
    });
  }

  function drawChart(data) {
    const canvas = document.getElementById('payback-chart');
    if (!canvas) return;
    lastChartData = data;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const width = Math.max(280, rect.width);
    const height = 230;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const isDark = document.body.classList.contains('dark-mode');
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.08)';
    const noSolarColor = isDark ? '#94a3b8' : '#475569';
    const solarColor = '#10b981';

    const pad = { top: 18, right: 18, bottom: 32, left: 66 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const maxVal = Math.max(
      data.semSolar[data.semSolar.length - 1],
      data.comSolar[data.comSolar.length - 1],
      1000
    ) * 1.08;

    function xPos(yearIdx) {
      return pad.left + (yearIdx / (data.semSolar.length - 1)) * plotW;
    }

    function yPos(val) {
      return pad.top + plotH - (val / maxVal) * plotH;
    }

    // Horizontal grid & Y labels
    ctx.font = '11px Inter, sans-serif';
    ctx.fillStyle = textColor;
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;

    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const val = (maxVal / ticks) * i;
      const y = yPos(val);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();

      const label = 'R$ ' + Math.round(val / 1000) + 'k';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pad.left - 8, y);
    }

    // X labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    [0, 5, 10, 15].forEach(function (yr) {
      if (yr < data.semSolar.length) {
        ctx.fillText('Ano ' + yr, xPos(yr), height - pad.bottom + 8);
      }
    });

    // Line: Sem Solar
    ctx.beginPath();
    ctx.strokeStyle = noSolarColor;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);
    data.semSolar.forEach(function (val, idx) {
      const x = xPos(idx);
      const y = yPos(val);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Line: Com Solar
    ctx.beginPath();
    ctx.strokeStyle = solarColor;
    ctx.lineWidth = 3;
    data.comSolar.forEach(function (val, idx) {
      const x = xPos(idx);
      const y = yPos(val);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Payback marker if within 15 years
    if (data.paybackYears > 0 && data.paybackYears <= 15) {
      const px = xPos(data.paybackYears);
      const idxFloor = Math.floor(data.paybackYears);
      const frac = data.paybackYears - idxFloor;
      const valAtPayback =
        data.comSolar[idxFloor] +
        ((data.comSolar[Math.min(15, idxFloor + 1)] - data.comSolar[idxFloor]) * frac);
      const py = yPos(valAtPayback);

      ctx.beginPath();
      ctx.fillStyle = '#d97706';
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = isDark ? '#fcd34d' : '#92400e';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = px > width * 0.72 ? 'right' : 'left';
      ctx.fillText('Payback', px + (px > width * 0.72 ? -8 : 8), py - 10);
    }
  }

  window.redrawSolarChart = function () {
    if (lastChartData) {
      drawChart(lastChartData);
    }
  };

  window.calcularSimulacao = function () {
    const gastoNormal = Math.max(0, parseFloat(document.getElementById('gasto-normal').value) || 0);
    const gastoVerao = Math.max(0, parseFloat(document.getElementById('gasto-verao').value) || 0);
    const mesesVerao = parseInt(document.getElementById('meses-verao').value, 10) || 4;
    const regiaoKey = document.getElementById('regiao').value || 'SE';
    const padraoKey = document.getElementById('padrao').value || 'bi';
    const telhadoKey = document.getElementById('telhado').value || 'ceramico';

    const regiao = REGIONS[regiaoKey] || REGIONS.SE;
    const taxaMinimaKwh = TAXA_MINIMA_KWH[padraoKey] || 50;
    const fatorTelhado = FATOR_TELHADO[telhadoKey] || 1.0;

    // 1. Média ponderada real (normal + verão)
    const mesesNormais = 12 - mesesVerao;
    const gastoMedioMensal = (gastoNormal * mesesNormais + gastoVerao * mesesVerao) / 12;
    const gastoAnualSemSolar = gastoMedioMensal * 12;

    const aumentoVeraoPct = gastoNormal > 0
      ? Math.round(((gastoVerao - gastoNormal) / gastoNormal) * 100)
      : 0;

    // 2. Consumo em kWh (descontando CIP média ~R$ 25)
    const cipMedia = 25;
    const consumoMedioKwh = Math.max(0, (gastoMedioMensal - cipMedia) / regiao.tarifa);
    const consumoVeraoKwh = Math.max(0, (gastoVerao - cipMedia) / regiao.tarifa);

    // 3. Dimensionamento (painéis de 550W, PR 0.78)
    const geracaoPorKwpMes = regiao.hsp * 30.4 * 0.78;
    const kwpBruto = consumoMedioKwh / geracaoPorKwpMes;
    const numPaineis = Math.max(3, Math.round(kwpBruto / 0.55));
    const kwpFinal = numPaineis * 0.55;
    const areaTelhado = numPaineis * 2.6;

    // 4. Custos 2026 (Equipamentos + Instalação/Homologação)
    const custoKwp = getCostPerKwp(kwpFinal);
    const investimentoTotal = kwpFinal * custoKwp * fatorTelhado;
    const custoEquipamentos = investimentoTotal * 0.64;
    const custoInstalacao = investimentoTotal * 0.36;
    const investMin = investimentoTotal * 0.90;
    const investMax = investimentoTotal * 1.12;

    // 5. Lei 14.300 (Fio B a 60% em 2026) + Taxa Mínima
    const custoDisponibilidade = taxaMinimaKwh * regiao.tarifa;
    // ~68% injetado na rede; Fio B ~28% da tarifa cheia; em 2026 cobra-se 60% do Fio B
    const custoFioBMensal = (consumoMedioKwh * 0.68) * (regiao.tarifa * 0.28 * 0.60);
    const novaContaMedia = Math.min(
      gastoMedioMensal,
      Math.max(custoDisponibilidade, custoFioBMensal) + cipMedia
    );

    const novaContaNormal = Math.min(
      gastoNormal,
      Math.max(custoDisponibilidade, (Math.max(0, (gastoNormal - cipMedia) / regiao.tarifa) * 0.68) * (regiao.tarifa * 0.28 * 0.60)) + cipMedia
    );
    const novaContaVerao = Math.min(
      gastoVerao,
      Math.max(custoDisponibilidade, (consumoVeraoKwh * 0.68) * (regiao.tarifa * 0.28 * 0.60)) + cipMedia
    );

    const economiaMensalMedia = Math.max(0, gastoMedioMensal - novaContaMedia);

    // 6. Projeção de 25 anos (reajuste tarifário 6% a.a., degradação 0.5% a.a.)
    const semSolar15 = [0];
    const comSolar15 = [investimentoTotal];
    let acumSem = 0;
    let acumCom = investimentoTotal;
    let paybackYears = 0;
    let paybackFound = false;
    let economia15Anos = 0;
    let economia25Anos = 0;

    for (let yr = 1; yr <= 25; yr++) {
      const fatorInflacao = Math.pow(1.06, yr - 1);
      const fatorDegradacao = Math.pow(0.995, yr - 1);
      const gastoAnoSem = gastoAnualSemSolar * fatorInflacao;
      const economiaAno = (economiaMensalMedia * 12) * fatorInflacao * fatorDegradacao;
      const gastoAnoCom = Math.max(0, gastoAnoSem - economiaAno);

      const prevDiff = acumSem - acumCom;
      acumSem += gastoAnoSem;
      acumCom += gastoAnoCom;
      const newDiff = acumSem - acumCom;

      if (!paybackFound && newDiff >= 0) {
        const stepGain = newDiff - prevDiff;
        const frac = stepGain > 0 ? Math.abs(prevDiff) / stepGain : 0;
        paybackYears = (yr - 1) + frac;
        paybackFound = true;
      }

      if (yr <= 15) {
        semSolar15.push(acumSem);
        comSolar15.push(acumCom);
      }
      if (yr === 15) {
        economia15Anos = acumSem - acumCom;
      }
      if (yr === 25) {
        economia25Anos = acumSem - acumCom;
      }
    }

    if (!paybackFound) {
      paybackYears = economiaMensalMedia > 0 ? investimentoTotal / (economiaMensalMedia * 12) : 99;
    }

    // 7. Atualizar UI
    const banner = document.getElementById('viability-banner');
    const vTag = document.getElementById('viability-tag');
    const vTitle = document.getElementById('viability-title');
    const vDesc = document.getElementById('viability-desc');

    if (gastoMedioMensal < 160 || economiaMensalMedia < 75 || paybackYears > 7.5) {
      banner.className = 'viability-banner low';
      vTag.textContent = 'Baixa Viabilidade';
      vTitle.textContent = 'Retorno lento para o seu consumo atual';
      vDesc.textContent =
        'Como sua conta média é próxima da taxa mínima da distribuidora e dos custos fixos de projeto/instalação, o investimento demoraria mais de ' +
        paybackYears.toFixed(1).replace('.', ',') +
        ' anos para se pagar. Avalie energia solar por assinatura ou aguarde caso seu consumo aumente.';
    } else if (paybackYears <= 4.8 && gastoMedioMensal >= 280) {
      banner.className = 'viability-banner high';
      vTag.textContent = 'Alta Viabilidade';
      vTitle.textContent = 'Vale muito a pena instalar energia solar!';
      vDesc.textContent =
        'Com sua média anual de ' + formatBRL(gastoMedioMensal) +
        '/mês (incluindo o pico de verão), o sistema se paga em cerca de ' +
        formatPayback(paybackYears) + ' e gera lucro líquido por mais de 20 anos.';
    } else {
      banner.className = 'viability-banner medium';
      vTag.textContent = 'Viabilidade Moderada';
      vTitle.textContent = 'Vale a pena pensando no médio e longo prazo';
      vDesc.textContent =
        'O retorno estimado é de ' + formatPayback(paybackYears) +
        '. Embora a conta não seja altíssima, os reajustes anuais da tarifa e os picos de verão tornam o investimento positivo ao longo dos anos.';
    }

    document.getElementById('res-investimento').textContent = formatBRL(investimentoTotal);
    document.getElementById('res-invest-faixa').textContent =
      'Faixa de mercado: ' + formatBRL(investMin) + ' a ' + formatBRL(investMax);

    document.getElementById('res-payback').textContent = paybackYears > 25 ? '+25 anos' : formatPayback(paybackYears);
    document.getElementById('res-economia-mes').textContent = formatBRL(economiaMensalMedia) + '/mês';
    document.getElementById('res-nova-conta').textContent =
      'Nova conta média estimada: ' + formatBRL(novaContaMedia) + '/mês';

    document.getElementById('res-lucro-25').textContent = formatBRL(Math.max(0, economia25Anos));
    document.getElementById('res-lucro-15').textContent =
      'Em 15 anos: ' + formatBRL(Math.max(0, economia15Anos));

    // Detalhes Técnicos & Custos
    document.getElementById('det-media-real').textContent = formatBRL(gastoMedioMensal) + '/mês';
    document.getElementById('det-consumo-kwh').textContent = Math.round(consumoMedioKwh) + ' kWh/mês';
    document.getElementById('det-potencia').textContent =
      kwpFinal.toFixed(2).replace('.', ',') + ' kWp (' + numPaineis + ' placas de 550W)';
    document.getElementById('det-area').textContent = areaTelhado.toFixed(0) + ' m² de telhado';
    document.getElementById('det-equipamentos').textContent = formatBRL(custoEquipamentos);
    document.getElementById('det-instalacao').textContent = formatBRL(custoInstalacao);

    // Barras Comparativas (Normal vs Verão)
    const maxBar = Math.max(gastoVerao, gastoNormal, 100);
    document.getElementById('lbl-normal-antes').textContent = formatBRL(gastoNormal);
    document.getElementById('lbl-normal-depois').textContent = formatBRL(novaContaNormal);
    document.getElementById('bar-normal-antes').style.width = Math.min(100, (gastoNormal / maxBar) * 100) + '%';
    document.getElementById('bar-normal-depois').style.width = Math.min(100, (novaContaNormal / maxBar) * 100) + '%';

    document.getElementById('lbl-verao-antes').textContent =
      formatBRL(gastoVerao) + (aumentoVeraoPct > 0 ? ' (+' + aumentoVeraoPct + '%)' : '');
    document.getElementById('lbl-verao-depois').textContent = formatBRL(novaContaVerao);
    document.getElementById('bar-verao-antes').style.width = Math.min(100, (gastoVerao / maxBar) * 100) + '%';
    document.getElementById('bar-verao-depois').style.width = Math.min(100, (novaContaVerao / maxBar) * 100) + '%';

    drawChart({
      semSolar: semSolar15,
      comSolar: comSolar15,
      paybackYears: paybackYears
    });
  };

  function formatPayback(years) {
    if (years >= 25) return '+25 anos';
    const wholeYears = Math.floor(years);
    const months = Math.round((years - wholeYears) * 12);
    if (months === 12) {
      return (wholeYears + 1) + (wholeYears + 1 === 1 ? ' ano' : ' anos');
    }
    if (wholeYears === 0) {
      return months + (months === 1 ? ' mês' : ' meses');
    }
    if (months === 0) {
      return wholeYears + (wholeYears === 1 ? ' ano' : ' anos');
    }
    return wholeYears + (wholeYears === 1 ? ' ano e ' : ' anos e ') + months + (months === 1 ? ' mês' : ' meses');
  }

  document.addEventListener('DOMContentLoaded', function () {
    syncInputAndRange('gasto-normal', 'range-normal');
    syncInputAndRange('gasto-verao', 'range-verao');
    setupCepLookup();

    ['meses-verao', 'regiao', 'padrao', 'telhado'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', calcularSimulacao);
    });

    const form = document.getElementById('simulador-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        calcularSimulacao();
        const resEl = document.getElementById('resultado-painel');
        if (resEl && window.innerWidth <= 960) {
          resEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }

    window.addEventListener('resize', function () {
      if (lastChartData) drawChart(lastChartData);
    });

    // Executa simulação inicial para o usuário já visualizar dados reais ao abrir
    calcularSimulacao();
  });
})();
