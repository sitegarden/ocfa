const filterButtons = document.querySelectorAll(".filter-btn");
const roomCards = document.querySelectorAll(".room-card");

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.filter;

    filterButtons.forEach((btn) => {
      btn.classList.remove("active");
    });

    button.classList.add("active");

    roomCards.forEach((card) => {
      const categories = card.dataset.category || "";

      if (filter === "all" || categories.includes(filter)) {
        card.classList.remove("is-hidden");
      } else {
        card.classList.add("is-hidden");
      }
    });
  });
});
