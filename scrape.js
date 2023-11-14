import puppeteer from 'puppeteer';

// ================== GLOBAL VARIABLES ==================
let page = null
let browser = null

// ================== HELPER FUNCTIONS ==================

async function readInnerText(selector) {
    await page.waitForSelector(selector)
    return await page.evaluate((selector) => document.querySelector(selector).innerText ?? "", selector)
}

/**
 * Setup
 */
async function setup() {
    // Launch the browser and open a new blank page
    browser = await puppeteer.launch({headless: 'new'});
    page = await browser.newPage();

    // navigate the page to a URL
    await page.goto('https://dk.openfoodfacts.org/');

    // set screen size
    await page.setViewport({width: 1080, height: 1024});
}

async function searchForProduct(product) {
    // 'søg efter produkt' input element
    await page.click("#offNav > nav > section > ul.left.small-4 > li > form > div > div > div > div:nth-child(1) > input[type=text]:nth-child(1)")

    // write to input element
    page.keyboard.sendCharacter(product)

    // click search
    await page.click("#offNav > nav > section > ul.left.small-4 > li > form > div > div > div > div:nth-child(2) > button")

    try {
        await page.waitForSelector("#products_match_all", { timeout: 2000 })
    } catch (e) {
        throw "Did not find any products with: " + product
    }
}

async function waitForTimeout() {
    await page.waitForTimeout(2000)
}

async function waitForNavigation() {
    await page.waitForNavigation()
}

async function waitForSelector(selector) {
    await page.waitForSelector(selector)
}

async function runFuncAtEachProduct(product, maxPages, useNonDanishProducts, callback) {
    const data = []

    await page.exposeFunction("callback", callback)

    // search for given product
    await searchForProduct(product)

    // clicks on whole world - for testing on many products
    if (useNonDanishProducts) {
        await page.click("#main_column > div:nth-child(4) > div > p:nth-child(1) > a")
    }

    const numOfProducts = await readInnerText("#main_column > div.block.short.block_ristreto > div > div > div:nth-child(1) > span")
    console.log(numOfProducts)

    // check if pages exists
    const pages = await page.evaluate(() => {
        return document.querySelector("#pages") ?? null
    }) 

    // only a single page
    if (!pages || maxPages < 2) { 
        return await page.evaluate(async () => {
            const productsPerPage = []
            const products = document.querySelector("#products_match_all")?.children

            for (let item of products) {
                const call = await callback(item)
                if (call) productsPerPage.push(call)
            }
        return productsPerPage
        })

    } else {
        const totalPages = await page.evaluate(() => {
            return [...document.querySelector("#pages").children]
                .map(page => page && parseInt(page.innerText))
                .filter(page => page)
                .pop()
        })

        if(maxPages > totalPages) {
            maxPages = totalPages
        }

        console.log("Going through: " + maxPages + " page(s)")

        let currentPage = await page.evaluateHandle(() => document.querySelector("#pages > li.current"));
        let currentPageIndex = 1
    
        while (currentPage && maxPages > 0) {
            console.log("Searching through page: " + currentPageIndex)
            const productsPrPage = await page.evaluate(async () => {
                const productsPerPage = []
                const products = document.querySelector("#products_match_all")?.children
    
                for (let item of products) {
                    const call = await callback(item)
                    if (call) productsPerPage.push(call)
                }
                return productsPerPage
            })
    
            data.push(productsPrPage)
    
            // set current page to next page
            currentPage = await page.evaluateHandle(() => document.querySelector("#pages > li.current").nextElementSibling?.children[0]) 
            // click on next page
            try {
                currentPage.click()
                await page.waitForNavigation({ timeout: 2000 }) // wait for next page to load
            } catch(e) {
                // no more pages, exit the loop
                break;
            }
            maxPages--
            currentPageIndex++
        }
    }
    return data
}


async function hasProductData(item) {
    return await page.evaluate(async (item) => {
        const productData = item.querySelector(".list_product_sc").children
        
        const nutriScoreTitle = productData[0].title
        const novaScoreTitle = productData[1].title
        const enviorimentScore = productData[2].title

        if (nutriScoreTitle !== "Nutri-Score ukendt - Mangler data til beregning af Nutri-Score" && novaScoreTitle !== "NOVA ikke beregnet - Fødevareforarbejdningsniveau ukendt" && enviorimentScore !== "Eco-Score ikke beregnet - Ukendt miljøpåvirkning") {
            return { name: item.innerText, url: item.children[0].href }
        }
    }, item)
}

async function test(product) {
    await page.exposeFunction("waitForSelector", waitForSelector)

    await searchForProduct(product)

    const productUrl = await page.evaluate(() => {
        const products = document.querySelector("#products_match_all")?.children;
        return products[0].children[0].href;
    });

    await page.goto(productUrl);

    // Wait for the desired selector on the product page
    await waitForSelector("#product > div > div > div.card-section > div > div.medium-8.small-12.columns > h2");
}




async function getProductsText(item) {
    return await page.evaluate((item) => {
        return item.innerText
    }, item)
}

/**
 * 
 * @returns the found ingrident. If none found return 'No ingredients found'
 */
async function readIngredients() {
    // check if item has ingredients
    const hasIngredients = await readInnerText("#panel_ingredients > li > a > h4") !== "Ingredienser mangler"

    // read ingredients if avaiable
    if (hasIngredients) {
        return await readInnerText("#panel_ingredients_content > div:nth-child(1) > div > div")
    } else {
        console.log("No ingredients found")
        return null // TODO: think of something else here
    }
}

/**
 * 
 * @param {String} selector
 * @returns 
 */
async function readNutritionTable() {
    await page.waitForSelector("#panel_nutrition_facts_table_content > div > table")
    return await page.evaluate(() => {
        const header = []
        const bodys = {}
        
        const table = document.querySelector("#panel_nutrition_facts_table_content > div > table").children
        const head = table[0]
        const body = table[1]

        const headerRow = head.children[0].children
        const bodyRows = body.children

        let headerRowLength = headerRow.length
        let bodyRowsLength = bodyRows[0].children.length

        if (headerRowLength > 2) { // for now, ignore every other row, except first and second row
            headerRowLength = 2
            bodyRowsLength = 2
        }

        for (let i = 0; i < headerRowLength; i++) {
            header.push(headerRow[i].innerText)
        }

        for (let i = 0; i < bodyRows.length; i++) {
            const rows = bodyRows[i].children
            for (let j = 0; j < bodyRowsLength; j++) {
                const text = rows[j - 1]?.innerText 
                const row = rows[j].innerText

                if (text) {
                    bodys[text] = row
                }
            }
        }
        return { header: header, bodys }
    })
}

async function readFoodProcessing() {
    const foodProcessingText = await readInnerText("#panel_nova > li > a > h4") // good seelctor

    // Guard: check if exist
    if (!foodProcessingText) return {}

    let foodProcessingNovaIndex = -1
    
    switch (group.trim()) {
        case "Ubehandlede eller minimalt forarbejdede fødevarer":
            foodProcessingNovaIndex = 1
        case "Forarbejdede kulinariske ingredienser":
            foodProcessingNovaIndex = 2
        case "Forarbejdede fødevarer":
            foodProcessingNovaIndex = 3
        case "Ultraforarbejdede fødevarer":
            foodProcessingNovaIndex = 4
        default:
            console.log("Nova grouping not found")
            // noop
    }

    return { foodProcessingText, foodProcessingNovaIndex }
} 

async function readNutriScore() {
    const nutriScoreText = await readInnerText("#panel_nutriscore > li > a > h4") // good selector

    // Guard: check if score exists
    if (!nutriScoreIndex) return {}

    let nutriScoreIndex = "Nutri-score not found"

    switch(nutriScoreText.trim()) {
        case "Meget god ernæringskvalitet":
            nutriScoreIndex  = "A"
        case "God ernæringskvalitet":
            nutriScoreIndex = "B"
        case "Gennemsnitlig ernæringskvalitet":
            nutriScoreIndex = "C"
        case "Ringe ernæringskvalitet":
            nutriScoreIndex = "D"
        case "Dårlig ernæringskvalitet":
            nutriScoreIndex = "E"
        default:
            console.log("Read nutriscore not found")
            // noop
    }

    return { nutriScoreText, nutriScoreIndex }
}

async function readNutritionProcentage() {
    return await page.evaluate(() => {
        const nodes = []
        
        // This might not always be the first element - however, seems so
        let node = document.querySelector("#panel_nutrient_level_fat")

        if (node) {
            nodes.push(node.innerText) // add first element
            while (node && node.nextElementSibling?.nodeName === "UL") {
                node = node.nextElementSibling
                nodes.push(node.innerText)
            }
        }
        return nodes
    })
}

async function main() {
    try {
        await setup()
    
        // await gotoProduct("ketchup")

        const pages = await runFuncAtEachProduct("ketchup", 5, true, (item) => hasProductData(item))

        const urls = []

        // for (let p of pages) {
        //     const products = p
        //     for (let product of products) {
        //         const { name, url } = product
    
        //         await page.goto(url)

        //         // await page.waitForNavigation()
    
        //         console.log(page.url())
        //     }
        // }
        
    
        // const images = await hasProductData("ketchup")
    
        // console.log(images)
    
        // const products = await productsFound("ritter sport", 0, true)
        // console.log(products)
    
        // const nutriPorcentage = await readNutritionProcentage()
        // console.log(nutriPorcentage)
    
    
        // const nutriScore = await readNutriScore()
    
        // const score = getNutriScore(nutriScore)
        // console.log(score)
    
        // const foodProcessing = await readFoodProcessing()
    
        // const novaIndex = getNovaGrouping(foodProcessing)
    
        // console.log(novaIndex)
    
        // const data = await readNutritionTable()
        // console.log(data)
    
        await browser.close()
    } catch (e) {
        console.log(page.url())
        console.log(e)
        await browser.close()
    }
}

main()


