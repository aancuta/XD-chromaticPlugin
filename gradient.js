
import chroma from "chroma-js";
/**
* Shorthand for creating Elements.
* @param {*} tag The tag name of the element.
* @param {*} [props] Optional props.
* @param {*} children Child elements or strings
*/
function h(tag, props, ...children) {
    let element = document.createElement(tag);
    if (props) {
        if (props.nodeType || typeof props !== "object") {
            children.unshift(props);
        }
        else {
            for (let name in props) {
                let value = props[name];
                if (name == "style") {
                    Object.assign(element.style, value);
                }
                else {
                    element.setAttribute(name, value);
                    element[name] = value;
                }
            }
        }
    }
    for (let child of children) {
        element.appendChild(typeof child === "object" ? child : document.createTextNode(child));
    }
    return element;
}

let dialog;
function getDialog() {
    if (dialog == null) {
        dialog =
            h("dialog",
                h("form", { style: { width: 360 } },
                    h("h1", "Chromatic Gradients Plugin"),
                    h("p", ""),
                    h("p", "Please select at least one shape with a gradient fill."),
                    h("p", ""),
                    h("p", ""),
                    h("p", ""),
                    h("footer",
                        h("button", { uxpVariant:"cta", type:"submit", onclick() { dialog.close() } }, "OK")
                    )
                )
            )
    }
    return dialog;
}

// use powers of 2 for float precision
const DELTA_STOP = 1 / 1024;
const numberOfChromaticStops = 16;

// generate new stops location
const chromaticPluginStops = Array
                                .from(Array(numberOfChromaticStops + 1).keys())
                                .map(x => x / numberOfChromaticStops)
                                .slice(1, numberOfChromaticStops);

function myToString16(x) {
    let hex = x.toString(16);

    return hex.length === 1 ? '0' + hex : hex;
}

function rgbaToXDValue(rgba) {
    let hex = "" +
        myToString16(rgba.a) +
        myToString16(rgba.r) +
        myToString16(rgba.g) +
        myToString16(rgba.b);

    return parseInt(hex, 16);
}

function xdColorToRGBA(color) {
    // color is an integer in XD, with the first byte being a, second byte being r etc.
    let colorHexString = color.value.toString(16);

    return {
        "a": parseInt(colorHexString.slice(0, 2), 16),
        "r": parseInt(colorHexString.slice(2, 4), 16),
        "g": parseInt(colorHexString.slice(4, 6), 16),
        "b": parseInt(colorHexString.slice(6, 8), 16)
    };
}

function rgbaToChroma(rgba) {
    return "rgb(" + [rgba.r, rgba.g, rgba.b].toString()  + ")";
}

function chromaToRGBA(chromaColor) {
    let chromaRGBA = chromaColor.rgba();

    // convert `a` channel from [0..1] floats to [0,255] shorts as accurate as possible
    return {
        "a": Math.min(Math.round(chromaRGBA[3] * 255), 255), // chroma's `a` channel has values in [0..1]
        "r": chromaRGBA[0],
        "g": chromaRGBA[1],
        "b": chromaRGBA[2]
    };
}

function chromaToXDColor(chromaColor) {
    return {
        value: rgbaToXDValue(chromaToRGBA(chromaColor))
    };
}

function xdColorToChroma(color) {
    let rgba = xdColorToRGBA(color);
    return rgbaToChroma(rgba);
}

function generateScaleArray(colorStopArray, mode) {
    let scaleArray = [];

    // generate scales between each user defined stops
    for (var i = 1, n = colorStopArray.length; i < n; ++i) {
        let previousStop = colorStopArray[i - 1],
            currentStop = colorStopArray[i];

        scaleArray.push( {
            "domainStart" : previousStop.stop,
            "domainEnd" : currentStop.stop,
            "scale" : chroma.scale([previousStop, currentStop].map(x => xdColorToChroma(x.color)))
                        .mode(mode)
                        .domain([previousStop.stop, currentStop.stop])
        });
    }

    return scaleArray;
}

function isColorStopInScale(stop, scale) {
    return (scale.domainStart <= stop && stop <= scale.domainEnd);
}

function addColorStops(colorStopArray, mode) {
    // heuristic to recognize chromatic gradients
    if (colorStopArray.filter(x => chromaticPluginStops.includes(x.stop)).length >= 0.75 * numberOfChromaticStops) {
        return colorStopArray;
    }

    /* 
     * keep all user defined color stops; if any overlaps with chromatic stops
     * then move it slightly
     */
    let newColorStops = colorStopArray
        .map(function(stopEntry) {
            if (chromaticPluginStops.includes(stopEntry.stop)) {
                return {
                    "color": stopEntry.color,
                    "stop": stopEntry.stop + DELTA_STOP
                };
            } else {
                return stopEntry;
            }
        });
    let scaleArray = generateScaleArray(colorStopArray, mode);

    // add LAB color stops
    for (let i = 0, scaleArrayIndex = 0; i < numberOfChromaticStops - 1; ++i) {
        let currentStop = chromaticPluginStops[i];

        // find the scale that contains this stop
        while (!isColorStopInScale(currentStop, scaleArray[scaleArrayIndex])) {
            ++scaleArrayIndex;
        }

        let scale         = scaleArray[scaleArrayIndex],
            scaleFunction = scale.scale;

        newColorStops.push({
            "color": chromaToXDColor(scaleFunction(currentStop)),
            "stop": currentStop
        });
    }

    // stops must be in ascending order, else XD cries out loud
    newColorStops.sort((s1, s2) => s1.stop - s2.stop);

    return newColorStops;
}

function chromaticGradientWrapper(selection, mode) {
    let errorCount = 0;

    for (var i = 0; i < selection.items.length; ++i) {
        try {
            // wrapping all this in a try block (e.g. Could have some text box in the selection which would throw
            // because it doesn't have a fill property. This way, it just gets ignored.)
            let firstSelectionItem = selection.items[i],
                oldFill            = firstSelectionItem.fill,
                gradient           = oldFill.clone(),
                colorStops         = gradient.colorStops,
                newColorStops      = addColorStops(colorStops, mode);

            // XD API for gradient replacement from plugins
            gradient.colorStops = newColorStops;
            selection.items[i].fill = gradient;
        } catch (err) {
            // Preserve the JS logs though
            errorCount += 1;
            console.log(err);
        }
    }

    if (errorCount === selection.items.length) {
        document.body.appendChild(getDialog()).showModal();
    }
}

function undoChromaticGradient(selection) {
    let errorCount = 0;

    for (var i = 0; i < selection.items.length; ++i) {
        try {
            let firstSelectionItem = selection.items[i],
                oldFill            = firstSelectionItem.fill,
                gradient           = oldFill.clone(),
                colorStops         = gradient.colorStops,
                newColorStops      = colorStops.filter(x => !chromaticPluginStops.includes(x.stop));

            gradient.colorStops = newColorStops;
            selection.items[i].fill = gradient;
        } catch (err) {
            // Preserve the JS logs though
            errorCount += 1;
            console.log(err);
        }
    }

    if (errorCount === selection.items.length) {
        document.body.appendChild(getDialog()).showModal();
    }
}

function labGradient(selection) {
    chromaticGradientWrapper(selection, "lab");
}

function lrgbGradient(selection) {
    chromaticGradientWrapper(selection, "lrgb");
}

function lchGradient(selection) {
    chromaticGradientWrapper(selection, "lch");
}

exports.commands = {
    labGradient: labGradient,
    lrgbGradient: lrgbGradient,
    lchGradient: lchGradient,
    undoChromaticGradient: undoChromaticGradient
};

