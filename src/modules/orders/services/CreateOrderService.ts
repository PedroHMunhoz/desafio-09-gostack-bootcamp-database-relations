import { inject, injectable } from 'tsyringe';

import AppError from '@shared/errors/AppError';

import IProductsRepository from '@modules/products/repositories/IProductsRepository';
import ICustomersRepository from '@modules/customers/repositories/ICustomersRepository';
import Product from '@modules/products/infra/typeorm/entities/Product';
import Order from '../infra/typeorm/entities/Order';
import IOrdersRepository from '../repositories/IOrdersRepository';

interface IProduct {
  id: string;
  quantity: number;
}

interface IRequest {
  customer_id: string;
  products: IProduct[];
}

@injectable()
class CreateOrderService {
  constructor(
    @inject('OrdersRepository')
    private ordersRepository: IOrdersRepository,

    @inject('ProductsRepository')
    private productsRepository: IProductsRepository,

    @inject('CustomersRepository')
    private customersRepository: ICustomersRepository,
  ) {}

  public async execute({ customer_id, products }: IRequest): Promise<Order> {
    // Busca o cliente na base de dados
    const customer = await this.customersRepository.findById(customer_id);

    // Se não achou o cliente, dá erro
    if (!customer) {
      throw new AppError('Customer not found!');
    }

    // Busca no banco de dados os produtos com os IDs que vieram do request
    const productsDb = await this.productsRepository.findAllById(products);

    // Se não achou nenhum produto, dá erro
    if (!productsDb.length) {
      throw new AppError('No products where found with the given IDs!');
    }

    // Pega os IDs dos produtos existentes em um novo array
    const existentProductsIds = productsDb.map(product => product.id);

    // Aqui é feito um filtro no array products e dentro dele verificamos
    // se ele NÃO INCLUI algum dos IDs encontrados no banco. Se não incluir,
    // significa que algum deles não existe
    const inexistentProducts = products.filter(
      product => !existentProductsIds.includes(product.id),
    );

    // Se retornou, é porque tem produtos inexistentes, nesse caso dá erro
    if (inexistentProducts.length) {
      throw new AppError(
        `Could not find product with ID ${inexistentProducts[0].id}!`,
      );
    }

    /** Aqui filtramos o array enviado e verificamos para cada produto que bata
     * com o ID informado, se a quantidade dele no banco é MENOR que a quantidade
     * solicitada pela requisição
     */
    const findProductsOutOfStock = products.filter(
      product =>
        productsDb.filter(p => p.id === product.id)[0].quantity <
        product.quantity,
    );

    /** Se veio resultados no filter, significa que temos produtos com quantidade
     * menor que a solicitada, portanto não deve deixar passar
     */
    if (findProductsOutOfStock.length) {
      throw new AppError(
        `The product with ID ${findProductsOutOfStock[0].id} doesn't have the requested quantity available!`,
      );
    }

    /** Aqui mapeamos os produtos a serem inseridos, pegando o preço de cada um
     * deles conforme o valor que estava no banco de dados ao ler o produto
     */
    const productsToInsert = products.map(product => ({
      product_id: product.id,
      quantity: product.quantity,
      price: productsDb.filter(p => p.id === product.id)[0].price,
    }));

    // Criamos o novo pedido (order)
    const order = await this.ordersRepository.create({
      customer,
      products: productsToInsert,
    });

    // Para pegar todos os produtos do pedido
    const { order_products } = order;

    /** Vamos reduzir a quantidade em estoque dos itens adicionados */
    const orderedQuantity = order_products.map(product => ({
      id: product.product_id,
      quantity:
        productsDb.filter(p => p.id === product.product_id)[0].quantity -
        product.quantity,
    }));

    // Atualiza o estoque
    await this.productsRepository.updateQuantity(orderedQuantity);

    // Retorna o pedido recém criado
    return order;
  }
}

export default CreateOrderService;
