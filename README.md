# Eiffel Tower Qwen and the Qwen Neuron Map

The source of two web pages about what individual neurons in the open language model Qwen3-8B do:

- **Eiffel Tower Qwen** - an interactive explainer: turn a handful of neurons up and watch the Eiffel Tower take over
  the model's answers; switch them off and watch it forget. https://eiffel-tower-qwen.vercel.app/
- **The Qwen Neuron Map** - every Qwen3-8B neuron tied to a job so far, by layer and subject.
  https://eiffel-tower-qwen.vercel.app/map/

The measurements come from [Model Mapper](https://github.com/jphoenix-dev/ModelMapper); the full record of how they
were made is the Zenodo snapshot [doi:10.5281/zenodo.23459925](https://doi.org/10.5281/zenodo.23459925).

## Layout

| Folder | What it is |
|---|---|
| `site/` | The static site that is deployed (Vercel project root directory: `site`). No build step. |
| `gen/` | The scripts that generate the page data from Model Mapper's results. |
| `data/` | The inputs those scripts read that are small enough to keep here. |

To view locally: `python -m http.server` in `site/`, then open http://localhost:8000/.

James Phoenix & Claude Opus 5.5. MIT licence; FineWeb excerpts ODC-By 1.0; Qwen outputs Apache 2.0.
